import { getJson } from "@/lib/mcp/http";
import { resultHash, spanId } from "@/lib/mcp/hash";
import type { EvidenceSpan } from "@/schemas/span";
import type { ToolResult } from "@/tools/registry";

type FredSeries = {
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

function fredKey(): string | null {
  const key = process.env.FRED_API_KEY?.trim();
  return key || null;
}

function fredUrl(path: string, params: Record<string, string>): string {
  const url = new URL(`https://api.stlouisfed.org/fred/${path}`);
  url.searchParams.set("file_type", "json");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const apiKey = fredKey();
  if (apiKey) url.searchParams.set("api_key", apiKey);
  return url.toString();
}

export async function searchSeries(
  args: Record<string, unknown>,
): Promise<ToolResult<{ series: FredSeries[]; span: EvidenceSpan }>> {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) return { ok: false, error: "query required" };
  if (!fredKey()) {
    return { ok: false, error: "FRED_API_KEY is not set" };
  }
  const data = await getJson<{ seriess?: FredSeries[] }>(
    fredUrl("series/search", { search_text: query, limit: "5" }),
  );
  const series = (data.seriess ?? []).filter((row) => row.id && row.title).slice(0, 5);
  const hash = resultHash(series.map((row) => row.id));
  const span: EvidenceSpan = {
    id: spanId("econ-series", "search_series", hash),
    server: "econ-series",
    tool: "econ.search_series",
    citation: series[0]
      ? `FRED search “${query}” → ${series[0].id}`
      : `FRED search “${query}” returned no series`,
    url: series[0]
      ? `https://fred.stlouisfed.org/series/${series[0].id}`
      : "https://fred.stlouisfed.org/",
    seriesId: series[0]?.id,
    frequency: series[0]?.frequency,
    units: series[0]?.units,
    resultHash: hash,
  };
  return { ok: true, data: { series, span }, spanId: span.id };
}

export async function getObservations(
  args: Record<string, unknown>,
): Promise<ToolResult<{ seriesId: string; observations: FredObs[]; span: EvidenceSpan }>> {
  const seriesId =
    typeof args.seriesId === "string" ? args.seriesId.trim().toUpperCase() : "";
  if (!seriesId) return { ok: false, error: "seriesId required" };
  if (!fredKey()) {
    return { ok: false, error: "FRED_API_KEY is not set" };
  }
  const data = await getJson<{ observations?: FredObs[] }>(
    fredUrl("series/observations", {
      series_id: seriesId,
      sort_order: "desc",
      limit: "8",
    }),
  );
  const observations = (data.observations ?? []).filter(
    (row) => row.date && row.value && row.value !== ".",
  );
  const hash = resultHash({ seriesId, observations });
  const latest = observations[0];
  const span: EvidenceSpan = {
    id: spanId("econ-series", "get_observations", hash),
    server: "econ-series",
    tool: "econ.get_observations",
    citation: latest
      ? `FRED ${seriesId} ${latest.date} = ${latest.value}`
      : `FRED ${seriesId} returned no observations`,
    url: `https://fred.stlouisfed.org/series/${seriesId}`,
    seriesId,
    vintage: latest?.date,
    resultHash: hash,
  };
  return { ok: true, data: { seriesId, observations, span }, spanId: span.id };
}

export async function getVintage(
  args: Record<string, unknown>,
): Promise<ToolResult<{ seriesId: string; vintage: string; span: EvidenceSpan }>> {
  const seriesId =
    typeof args.seriesId === "string" ? args.seriesId.trim().toUpperCase() : "";
  if (!seriesId) return { ok: false, error: "seriesId required" };
  if (!fredKey()) {
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
