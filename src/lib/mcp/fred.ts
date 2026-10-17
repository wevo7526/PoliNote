import { getJson } from "@/lib/mcp/http";
import { resultHash, spanId } from "@/lib/mcp/hash";
import type { EvidenceSpan, SeriesPoint } from "@/schemas/span";
import type { ToolResult } from "@/tools/registry";

export type FredSeries = {
  id?: string;
  title?: string;
  frequency?: string;
  units?: string;
  observation_start?: string;
  observation_end?: string;
};

type FredObs = {
  date?: string;
  value?: string;
};

type CanonicalSeries = {
  id: string;
  title: string;
  units: string;
  frequency: string;
  keywords: string[];
};

const CANONICAL_FRED_SERIES: CanonicalSeries[] = [
  {
    id: "IMPGS",
    title: "Imports of Goods and Services",
    units: "Billions of Dollars",
    frequency: "Quarterly",
    keywords: ["tariff", "import", "trade", "border", "customs", "duty", "export", "cbam"],
  },
  {
    id: "CUSR0000SETA01",
    title: "Consumer Price Index: New Vehicles",
    units: "Index 1982-1984=100",
    frequency: "Monthly",
    keywords: ["vehicle", "ev", "auto", "car", "battery", "automotive", "truck"],
  },
  {
    id: "CUSR0000SEHA",
    title: "Consumer Price Index: Rent of Primary Residence",
    units: "Index 1982-1984=100",
    frequency: "Monthly",
    keywords: ["housing", "rent", "zoning", "upzone", "transit", "apartment", "land"],
  },
  {
    id: "HOUST",
    title: "New Privately-Owned Housing Units Started",
    units: "Thousands of Units",
    frequency: "Monthly",
    keywords: ["housing", "construction", "permit", "multifamily", "home", "building"],
  },
  {
    id: "INDPRO",
    title: "Industrial Production: Total Index",
    units: "Index 2017=100",
    frequency: "Monthly",
    keywords: [
      "semiconductor",
      "manufacturing",
      "steel",
      "aluminum",
      "industrial",
      "factory",
      "production",
      "subsidy",
      "chip",
    ],
  },
  {
    id: "MANEMP",
    title: "All Employees, Manufacturing",
    units: "Thousands of Persons",
    frequency: "Monthly",
    keywords: ["manufacturing", "assembly", "factory", "plant", "steel", "auto"],
  },
  {
    id: "UNRATE",
    title: "Unemployment Rate",
    units: "Percent",
    frequency: "Monthly",
    keywords: ["unemployment", "labor", "employment", "job", "worker", "wage", "workforce"],
  },
  {
    id: "PAYEMS",
    title: "All Employees, Total Nonfarm",
    units: "Thousands of Persons",
    frequency: "Monthly",
    keywords: ["payroll", "employment", "job", "labor", "worker"],
  },
  {
    id: "FEDFUNDS",
    title: "Federal Funds Effective Rate",
    units: "Percent",
    frequency: "Monthly",
    keywords: ["monetary", "fed", "interest", "rate", "central bank", "volcker", "liquidity"],
  },
  {
    id: "DGS10",
    title: "Market Yield on U.S. Treasury Securities at 10-Year Constant Maturity",
    units: "Percent",
    frequency: "Daily",
    keywords: ["treasury", "yield", "bond", "debt", "fiscal", "deficit", "borrowing"],
  },
  {
    id: "CPIAUCSL",
    title: "Consumer Price Index for All Urban Consumers: All Items",
    units: "Index 1982-1984=100",
    frequency: "Monthly",
    keywords: ["inflation", "cpi", "price", "consumer", "cost", "macro", "regime"],
  },
  {
    id: "GDPC1",
    title: "Real Gross Domestic Product",
    units: "Billions of Chained 2017 Dollars",
    frequency: "Quarterly",
    keywords: ["gdp", "growth", "output", "macro", "economy", "recession", "regime"],
  },
];

const STOP_WORDS = new Set([
  "what",
  "are",
  "the",
  "near",
  "term",
  "near-term",
  "effects",
  "effect",
  "from",
  "with",
  "into",
  "under",
  "this",
  "that",
  "how",
  "does",
  "would",
  "could",
  "should",
  "policy",
  "question",
  "evaluate",
  "assess",
  "digress",
  "analysis",
  "tell",
  "about",
  "current",
]);

export function resolveFredKey(): string | null {
  const raw =
    process.env["FRED_API_KEY"] ||
    process.env["FRED_KEY"] ||
    process.env["NEXT_PUBLIC_FRED_API_KEY"] ||
    "";
  const cleaned = raw
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/^(?:FRED_API_KEY|api_key)\s*=\s*/i, "")
    .trim();
  if (!cleaned) return null;
  // FRED keys are 32 lowercase hex/alphanumeric characters
  const match32 = cleaned.match(/[a-zA-Z0-9]{32}/);
  return (match32 ? match32[0] : cleaned).toLowerCase();
}

export function cleanFredSearchText(query: string): string {
  const tokens = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
  const unique = tokens.filter((word, idx) => tokens.indexOf(word) === idx);
  return unique.slice(0, 4).join(" ") || "consumer price index";
}

export function resolveCanonicalSeries(query: string): CanonicalSeries[] {
  const lower = query.toLowerCase();
  const scored = CANONICAL_FRED_SERIES.map((item) => {
    const hits = item.keywords.filter((kw) => lower.includes(kw)).length;
    return { item, hits };
  })
    .filter((entry) => entry.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .map((entry) => entry.item);

  if (scored.length >= 2) return scored.slice(0, 4);
  const defaults = [
    CANONICAL_FRED_SERIES.find((s) => s.id === "CPIAUCSL")!,
    CANONICAL_FRED_SERIES.find((s) => s.id === "UNRATE")!,
    CANONICAL_FRED_SERIES.find((s) => s.id === "GDPC1")!,
  ];
  return [...scored, ...defaults].filter(
    (s, idx, arr) => arr.findIndex((x) => x.id === s.id) === idx,
  );
}

export function lookupCanonicalMeta(seriesId: string): CanonicalSeries | undefined {
  return CANONICAL_FRED_SERIES.find((s) => s.id === seriesId.toUpperCase());
}

function fredUrl(path: string, params: Record<string, string>): string {
  const url = new URL(`https://api.stlouisfed.org/fred/${path}`);
  url.searchParams.set("file_type", "json");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const apiKey = resolveFredKey();
  if (apiKey) url.searchParams.set("api_key", apiKey);
  return url.toString();
}

export async function searchSeries(
  args: Record<string, unknown>,
): Promise<ToolResult<{ series: FredSeries[]; span: EvidenceSpan }>> {
  const rawQuery = typeof args.query === "string" ? args.query.trim() : "";
  if (!rawQuery) return { ok: false, error: "query required" };
  if (!resolveFredKey()) {
    return { ok: false, error: "FRED_API_KEY is not set" };
  }

  const canonical = resolveCanonicalSeries(rawQuery);
  const searchText = cleanFredSearchText(rawQuery);
  let series: FredSeries[] = [];

  try {
    const data = await getJson<{ seriess?: FredSeries[] }>(
      fredUrl("series/search", { search_text: searchText, limit: "5" }),
    );
    series = (data.seriess ?? [])
      .filter((row) => row.id && row.title)
      .slice(0, 5);
  } catch {
    /* Fall back to canonical series below if search endpoint fails */
  }

  if (series.length === 0) {
    series = canonical.map((item) => ({
      id: item.id,
      title: item.title,
      units: item.units,
      frequency: item.frequency,
    }));
  } else {
    // Ensure top canonical match is included so domain-specific series are always available
    const topCanonical = canonical[0];
    if (topCanonical && !series.some((s) => s.id === topCanonical.id)) {
      series = [
        {
          id: topCanonical.id,
          title: topCanonical.title,
          units: topCanonical.units,
          frequency: topCanonical.frequency,
        },
        ...series,
      ].slice(0, 5);
    }
  }

  const lead = series[0];
  const hash = resultHash(series.map((row) => row.id));
  const span: EvidenceSpan = {
    id: spanId("econ-series", "search_series", hash),
    server: "econ-series",
    tool: "econ.search_series",
    citation: lead
      ? `FRED ${lead.id} (${lead.title ?? searchText})`
      : `FRED search “${searchText}”`,
    url: lead
      ? `https://fred.stlouisfed.org/series/${lead.id}`
      : "https://fred.stlouisfed.org/",
    seriesId: lead?.id,
    seriesTitle: lead?.title,
    frequency: lead?.frequency,
    units: lead?.units,
    resultHash: hash,
  };
  return { ok: true, data: { series, span }, spanId: span.id };
}

export async function getObservations(
  args: Record<string, unknown>,
): Promise<
  ToolResult<{
    seriesId: string;
    title: string;
    units: string;
    observations: FredObs[];
    seriesPoints: SeriesPoint[];
    span: EvidenceSpan;
  }>
> {
  const seriesId =
    typeof args.seriesId === "string" ? args.seriesId.trim().toUpperCase() : "";
  if (!seriesId) return { ok: false, error: "seriesId required" };
  if (!resolveFredKey()) {
    return { ok: false, error: "FRED_API_KEY is not set" };
  }

  const meta = lookupCanonicalMeta(seriesId);
  const passedTitle =
    typeof args.title === "string" && args.title.trim()
      ? args.title.trim()
      : meta?.title ?? `FRED ${seriesId}`;
  const passedUnits =
    typeof args.units === "string" && args.units.trim()
      ? args.units.trim()
      : meta?.units ?? "";

  const data = await getJson<{ observations?: FredObs[] }>(
    fredUrl("series/observations", {
      series_id: seriesId,
      sort_order: "desc",
      limit: "24",
    }),
  );

  const observations = (data.observations ?? []).filter(
    (row) =>
      row.date &&
      row.value &&
      row.value !== "." &&
      Number.isFinite(Number.parseFloat(row.value)),
  );

  const seriesPoints: SeriesPoint[] = [...observations]
    .reverse()
    .map((row) => ({
      date: row.date!,
      value: Number.parseFloat(row.value!),
    }));

  const hash = resultHash({ seriesId, observations: observations.slice(0, 8) });
  const latest = observations[0];
  const earliest = observations[observations.length - 1];
  const span: EvidenceSpan = {
    id: spanId("econ-series", "get_observations", hash),
    server: "econ-series",
    tool: "econ.get_observations",
    citation: latest
      ? `FRED ${seriesId} (${passedTitle}): ${latest.value}${passedUnits ? ` ${passedUnits}` : ""} (${latest.date}${earliest ? `, n=${observations.length} from ${earliest.date}` : ""})`
      : `FRED ${seriesId} returned no observations`,
    url: `https://fred.stlouisfed.org/series/${seriesId}`,
    seriesId,
    seriesTitle: passedTitle,
    units: passedUnits || undefined,
    vintage: latest?.date,
    seriesPoints,
    resultHash: hash,
  };
  return {
    ok: true,
    data: {
      seriesId,
      title: passedTitle,
      units: passedUnits,
      observations,
      seriesPoints,
      span,
    },
    spanId: span.id,
  };
}

export async function getVintage(
  args: Record<string, unknown>,
): Promise<ToolResult<{ seriesId: string; vintage: string; span: EvidenceSpan }>> {
  const seriesId =
    typeof args.seriesId === "string" ? args.seriesId.trim().toUpperCase() : "";
  if (!seriesId) return { ok: false, error: "seriesId required" };
  if (!resolveFredKey()) {
    return { ok: false, error: "FRED_API_KEY is not set" };
  }
  const data = await getJson<{ vintage_dates?: string[] }>(
    fredUrl("series/vintagedates", { series_id: seriesId, limit: "1" }),
  );
  const vintage = data.vintage_dates?.[0] ?? "";
  const hash = resultHash({ seriesId, vintage });
  const span: EvidenceSpan = {
    id: spanId("econ-series", "get_vintage", hash),
    server: "econ-series",
    tool: "econ.get_vintage",
    citation: vintage
      ? `FRED ${seriesId} vintage ${vintage}`
      : `FRED ${seriesId} has no vintage dates`,
    url: `https://fred.stlouisfed.org/series/${seriesId}`,
    seriesId,
    vintage: vintage || undefined,
    resultHash: hash,
  };
  return { ok: true, data: { seriesId, vintage, span }, spanId: span.id };
}
