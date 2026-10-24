import { fetchLiveJsonWithSnapshot } from "@/lib/data/cache";
import { DataUnavailableError } from "@/lib/data/types";
import { resultHash, spanId } from "@/lib/mcp/hash";
import type { EvidenceSpan } from "@/schemas/span";
import type { ToolResult } from "@/tools/registry";

type OpenAlexWork = {
  id?: string;
  display_name?: string;
  publication_year?: number;
  doi?: string;
  cited_by_count?: number;
  abstract_inverted_index?: Record<string, number[]>;
  primary_location?: {
    landing_page_url?: string;
    source?: { display_name?: string };
  };
};

export type ExtractedLiteratureEstimate = {
  workId: string;
  title: string;
  year?: number;
  doi?: string;
  url?: string;
  source?: string;
  /** Extracted numeric elasticity / effect ONLY when accompanied by a verbatim quoteSpan from the abstract. */
  pointEstimate?: number;
  standardError?: number;
  unitsOrMetric?: string;
  method?: string;
  sampleWindow?: string;
  quoteSpan?: string;
  honestyLabel: string;
};

/**
 * Reconstructs plain-text abstract from OpenAlex's abstract_inverted_index.
 */
export function reconstructAbstract(
  inverted?: Record<string, number[]>,
): string {
  if (!inverted || typeof inverted !== "object") return "";
  const wordsByPos: string[] = [];
  for (const [word, positions] of Object.entries(inverted)) {
    if (!Array.isArray(positions)) continue;
    for (const pos of positions) {
      if (typeof pos === "number" && pos >= 0 && pos < 5000) {
        wordsByPos[pos] = word;
      }
    }
  }
  return wordsByPos.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Deterministic extractor for empirical estimates reported inside a paper abstract.
 * Only populates `pointEstimate` when an explicit numeric sentence (`quoteSpan`) is present in the text.
 */
export function extractEstimateFromAbstract(
  work: OpenAlexWork,
  abstractText: string,
): Omit<ExtractedLiteratureEstimate, "workId" | "title" | "year" | "doi" | "url" | "source" | "honestyLabel"> {
  if (!abstractText) return {};

  const sentences = abstractText
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);

  let method: string | undefined;
  if (/difference-in-differences|diff-in-diff|\bDiD\b/i.test(abstractText)) {
    method = "Difference-in-Differences";
  } else if (/synthetic control/i.test(abstractText)) {
    method = "Synthetic Control";
  } else if (/regression discontinuity|\bRDD\b/i.test(abstractText)) {
    method = "Regression Discontinuity";
  } else if (/instrumental variable|\b2SLS\b|\bIV\b/i.test(abstractText)) {
    method = "Instrumental Variables (2SLS)";
  } else if (/event study/i.test(abstractText)) {
    method = "Event Study";
  } else if (/local projection|\bVAR\b|\bSVAR\b/i.test(abstractText)) {
    method = "Local Projections / SVAR";
  } else if (/panel|fixed effects/i.test(abstractText)) {
    method = "Panel Fixed Effects";
  }

  const windowMatch = abstractText.match(/\b(19\d{2}|20\d{2})\s*(?:to|–|-|—)\s*(19\d{2}|20\d{2})\b/);
  const sampleWindow = windowMatch ? `${windowMatch[1]}–${windowMatch[2]}` : undefined;

  // Match sentences reporting an elasticity, percentage effect, or coefficient
  for (const sentence of sentences) {
    if (
      !/elasticity|pass-through|effect|increase|decrease|reduce|raise|estimate|percent|%/i.test(
        sentence,
      )
    ) {
      continue;
    }
    const numMatch = sentence.match(
      /([+-]?\d+(?:\.\d+)?)\s*(%|percent|percentage points|basis points|log points)?/i,
    );
    if (!numMatch?.[1]) continue;
    const val = Number.parseFloat(numMatch[1]);
    if (!Number.isFinite(val)) continue;
    // Skip years like 2018 or 1995
    if (val >= 1900 && val <= 2100 && !numMatch[2]) continue;

    const seMatch = sentence.match(
      /(?:standard error|SE|s\.e\.)\s*(?:of|=|:)?\s*([0-9]+(?:\.[0-9]+)?)/i,
    );
    const se = seMatch?.[1] ? Number.parseFloat(seMatch[1]) : undefined;

    return {
      pointEstimate: val,
      standardError: Number.isFinite(se) ? se : undefined,
      unitsOrMetric: numMatch[2] || "reported effect",
      method,
      sampleWindow,
      quoteSpan: sentence.slice(0, 320),
    };
  }

  return {
    method,
    sampleWindow,
  };
}

export async function searchLiterature(
  args: Record<string, unknown>,
): Promise<
  ToolResult<{
    works: ExtractedLiteratureEstimate[];
    span: EvidenceSpan;
  }>
> {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) return { ok: false, error: "query required" };

  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", query);
  url.searchParams.set("per_page", "6");
  url.searchParams.set("filter", "type:article,language:en");

  try {
    const { data, snapshot } = await fetchLiveJsonWithSnapshot<{
      results?: OpenAlexWork[];
    }>({
      provider: "worldbank", // public academic endpoint
      seriesId: `openalex_${query.slice(0, 20)}`,
      url: url.toString(),
      init: {
        headers: {
          "User-Agent": "PoliNote/2.0 (mailto:research@polinote.org)",
        },
      },
    });

    const works: ExtractedLiteratureEstimate[] = (data.results ?? [])
      .slice(0, 6)
      .map((work) => {
        const title = work.display_name?.trim() || "Untitled work";
        const year = work.publication_year;
        const doi = work.doi;
        const workUrl = work.primary_location?.landing_page_url || doi || work.id;
        const source = work.primary_location?.source?.display_name;
        const abstractText = reconstructAbstract(work.abstract_inverted_index);
        const extracted = extractEstimateFromAbstract(work, abstractText);
        const citeRef = `${title.slice(0, 48)}${year ? ` (${year})` : ""}${doi ? ` · ${doi}` : ""}`;

        return {
          workId: work.id ?? title,
          title,
          year,
          doi,
          url: workUrl,
          source,
          ...extracted,
          honestyLabel: `Literature estimate (${citeRef})`,
        };
      });

    if (works.length === 0) {
      return {
        ok: false,
        error: `Data unavailable: OpenAlex — no peer-reviewed works matched "${query}"`,
      };
    }

    const hash = snapshot.sha256.slice(0, 16) || resultHash(works.map((w) => w.title));
    const first = works[0]!;
    const span: EvidenceSpan = {
      id: spanId("literature", "search", hash),
      server: "literature",
      tool: "lit.search",
      citation: `OpenAlex: ${first.title}${first.year ? ` (${first.year})` : ""}${first.doi ? ` [${first.doi}]` : ""}`,
      url: first.url,
      resultHash: snapshot.sha256,
    };
    return { ok: true, data: { works, span }, spanId: span.id };
  } catch (error) {
    const msg =
      error instanceof DataUnavailableError
        ? error.message
        : error instanceof Error
          ? `Data unavailable: OpenAlex — ${error.message}`
          : "Data unavailable: OpenAlex — request failed";
    return { ok: false, error: msg };
  }
}
