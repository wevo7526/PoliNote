import { getJson } from "@/lib/mcp/http";
import { resultHash, spanId } from "@/lib/mcp/hash";
import type { EvidenceSpan } from "@/schemas/span";
import type { ToolResult } from "@/tools/registry";

type OpenAlexWork = {
  id?: string;
  display_name?: string;
  publication_year?: number;
  doi?: string;
  primary_location?: { landing_page_url?: string; source?: { display_name?: string } };
};

export async function searchLiterature(
  args: Record<string, unknown>,
): Promise<
  ToolResult<{
    works: Array<{ title: string; year?: number; url?: string; source?: string }>;
    span: EvidenceSpan;
  }>
> {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) return { ok: false, error: "query required" };

  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", query);
  url.searchParams.set("per_page", "5");
  url.searchParams.set("filter", "type:article,language:en");

  const data = await getJson<{ results?: OpenAlexWork[] }>(url.toString(), {
    headers: { "User-Agent": "PoliNote/0.1 (mailto:research@polinote.local)" },
  });
  const works = (data.results ?? []).slice(0, 5).map((work) => ({
    title: work.display_name?.trim() || "Untitled work",
    year: work.publication_year,
    url: work.primary_location?.landing_page_url || work.doi || work.id,
    source: work.primary_location?.source?.display_name,
  }));
  const hash = resultHash(works.map((work) => work.title));
  const first = works[0];
  const span: EvidenceSpan = {
    id: spanId("literature", "search", hash),
    server: "literature",
    tool: "lit.search",
    citation: first
      ? `OpenAlex: ${first.title}${first.year ? ` (${first.year})` : ""}`
      : `OpenAlex search “${query}” returned no works`,
    url: first?.url,
    resultHash: hash,
  };
  return { ok: true, data: { works, span }, spanId: span.id };
}
