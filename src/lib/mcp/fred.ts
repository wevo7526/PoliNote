import {
  fetchFredVintageDates,
  fredProvider,
  resolveFredKey,
} from "@/lib/data/fred";
import {
  beaProvider,
  blsProvider,
  worldBankProvider,
} from "@/lib/data/providers";
import { buildProviderSearchQuery, deriveObservationWindow } from "@/lib/data/selector";
import {
  DataUnavailableError,
  type DataProvenance,
  type FredUnitsTransform,
  type RawSnapshotRecord,
  type SeriesMetadata,
} from "@/lib/data/types";
import { resultHash, spanId } from "@/lib/mcp/hash";
import type { EvidenceSpan, SeriesPoint } from "@/schemas/span";
import type { ToolResult } from "@/tools/registry";

export { resolveFredKey };

export type FredSeries = {
  id?: string;
  title?: string;
  frequency?: string;
  units?: string;
  seasonal_adjustment?: string;
  observation_start?: string;
  observation_end?: string;
  last_updated?: string;
  copyrightedThirdParty?: boolean;
  licenseAttribution?: string;
};

type FredObs = {
  date?: string;
  value?: string;
};

export function cleanFredSearchText(query: string): string {
  return buildProviderSearchQuery(query);
}

/**
 * Live FRED series search. Zero hardcoded series or fallback values.
 * If FRED_API_KEY is missing or FRED is unreachable, returns { ok: false, error: "Data unavailable: FRED ..." }.
 */
export async function searchSeries(
  args: Record<string, unknown>,
): Promise<
  ToolResult<{
    series: FredSeries[];
    metadata: SeriesMetadata[];
    span: EvidenceSpan;
  }>
> {
  const rawQuery = typeof args.query === "string" ? args.query.trim() : "";
  if (!rawQuery) return { ok: false, error: "query required" };

  if (!resolveFredKey()) {
    return {
      ok: false,
      error: "Data unavailable: FRED — FRED_API_KEY is not configured",
    };
  }

  const searchText = cleanFredSearchText(rawQuery);
  try {
    const metadataList = await fredProvider.search(searchText, 8);
    if (metadataList.length === 0) {
      return {
        ok: false,
        error: `Data unavailable: FRED — no series matched "${searchText}"`,
      };
    }

    const series: FredSeries[] = metadataList.map((m) => ({
      id: m.id,
      title: m.title,
      frequency: m.frequency,
      units: m.units,
      seasonal_adjustment: m.seasonalAdjustment,
      observation_start: m.observationStart,
      observation_end: m.observationEnd,
      last_updated: m.lastUpdated,
      copyrightedThirdParty: m.copyrightedThirdParty,
      licenseAttribution: m.licenseAttribution,
    }));

    const lead = series[0]!;
    const hash = resultHash(series.map((row) => row.id));
    const span: EvidenceSpan = {
      id: spanId("econ-series", "search_series", hash),
      server: "econ-series",
      tool: "econ.search_series",
      citation: `FRED ${lead.id} (${lead.title ?? searchText})`,
      url: `https://fred.stlouisfed.org/series/${lead.id}`,
      seriesId: lead.id,
      seriesTitle: lead.title,
      frequency: lead.frequency,
      units: lead.units,
      resultHash: hash,
    };

    return {
      ok: true,
      data: { series, metadata: metadataList, span },
      spanId: span.id,
    };
  } catch (error) {
    const msg =
      error instanceof DataUnavailableError
        ? error.message
        : error instanceof Error
          ? `Data unavailable: FRED — ${error.message}`
          : "Data unavailable: FRED — search failed";
    return { ok: false, error: msg };
  }
}

/**
 * Live FRED / ALFRED observations pull with full provenance and SHA-256 raw snapshot.
 * Zero hardcoded sample observations.
 */
export async function getObservations(
  args: Record<string, unknown>,
): Promise<
  ToolResult<{
    seriesId: string;
    title: string;
    units: string;
    observations: FredObs[];
    seriesPoints: SeriesPoint[];
    provenance: DataProvenance;
    snapshot: RawSnapshotRecord;
    span: EvidenceSpan;
  }>
> {
  const rawSeriesId =
    typeof args.seriesId === "string" ? args.seriesId.trim().toUpperCase() : "";
  if (!rawSeriesId) return { ok: false, error: "seriesId required" };

  // Route observation pulls by provider prefix (NIPA:/BEA:, BLS:, WB:/USA:, or FRED/ALFRED)
  const isBea = /^NIPA:|^BEA:/i.test(rawSeriesId);
  const isBls = /^BLS:/i.test(rawSeriesId);
  const isWb = /^WB:|^[A-Z]{3}:[A-Z0-9._]+$/i.test(rawSeriesId) && !isBea && !isBls;
  const seriesId = rawSeriesId.replace(/^(?:BEA|BLS|WB|FRED):/i, "");

  if (!isBea && !isBls && !isWb && !resolveFredKey()) {
    return {
      ok: false,
      error: `Data unavailable: FRED (${seriesId}) — FRED_API_KEY is not configured`,
    };
  }

  const defaultWin = deriveObservationWindow({
    question: typeof args.question === "string" ? args.question : seriesId,
    policyDate: typeof args.policyDate === "string" ? args.policyDate : undefined,
  });

  const start =
    typeof args.observationStart === "string" && args.observationStart.trim()
      ? args.observationStart.trim()
      : defaultWin.observationStart;
  const end =
    typeof args.observationEnd === "string" && args.observationEnd.trim()
      ? args.observationEnd.trim()
      : defaultWin.observationEnd;
  const units =
    typeof args.unitsTransform === "string"
      ? (args.unitsTransform as FredUnitsTransform)
      : "lin";
  const realtimeStart =
    typeof args.realtimeStart === "string" ? args.realtimeStart.trim() : undefined;
  const realtimeEnd =
    typeof args.realtimeEnd === "string" ? args.realtimeEnd.trim() : undefined;
  const outputType =
    args.outputType === 4 ? (4 as const) : undefined;

  try {
    const activeProvider = isBea
      ? beaProvider
      : isBls
        ? blsProvider
        : isWb
          ? worldBankProvider
          : fredProvider;

    const bundle = await activeProvider.observations(seriesId, {
      start,
      end,
      units,
      realtimeStart,
      realtimeEnd,
      outputType,
    });

    const observations: FredObs[] = bundle.observations.map((pt) => ({
      date: pt.date,
      value: String(pt.value),
    }));
    const seriesPoints: SeriesPoint[] = bundle.observations.map((pt) => ({
      date: pt.date,
      value: pt.value,
    }));

    const earliest = seriesPoints[0]!;
    const latest = seriesPoints[seriesPoints.length - 1]!;
    const hash = bundle.snapshot.sha256.slice(0, 16);
    const providerTag = bundle.provenance.source.toUpperCase();

    const span: EvidenceSpan = {
      id: spanId("econ-series", "get_observations", hash),
      server: "econ-series",
      tool: "econ.get_observations",
      citation: `${providerTag} ${seriesId} (${bundle.metadata.title}): ${latest.value} ${bundle.provenance.units} (${latest.date}, window ${earliest.date} to ${latest.date}, n=${seriesPoints.length}, vintage ${bundle.provenance.vintageDate ?? "latest"}, sha256=${hash})`,
      url: bundle.provenance.url,
      seriesId,
      seriesTitle: bundle.metadata.title,
      frequency: bundle.provenance.frequency,
      units: bundle.provenance.units,
      vintage: bundle.provenance.vintageDate,
      seriesPoints,
      resultHash: bundle.snapshot.sha256,
    };

    return {
      ok: true,
      data: {
        seriesId,
        title: bundle.metadata.title,
        units: bundle.provenance.units,
        observations,
        seriesPoints,
        provenance: bundle.provenance,
        snapshot: bundle.snapshot,
        span,
      },
      spanId: span.id,
    };
  } catch (error) {
    const msg =
      error instanceof DataUnavailableError
        ? error.message
        : error instanceof Error
          ? `Data unavailable: (${seriesId}) — ${error.message}`
          : `Data unavailable: (${seriesId}) — observation request failed`;
    return { ok: false, error: msg };
  }
}

export async function getVintage(
  args: Record<string, unknown>,
): Promise<ToolResult<{ seriesId: string; vintage: string; vintages: string[]; span: EvidenceSpan }>> {
  const seriesId =
    typeof args.seriesId === "string" ? args.seriesId.trim().toUpperCase() : "";
  if (!seriesId) return { ok: false, error: "seriesId required" };

  if (!resolveFredKey()) {
    return {
      ok: false,
      error: `Data unavailable: FRED (${seriesId}) — FRED_API_KEY is not configured`,
    };
  }

  const asOfDate =
    typeof args.asOfDate === "string" ? args.asOfDate.trim() : undefined;

  try {
    const vintages = await fetchFredVintageDates(seriesId, 12, asOfDate);
    const vintage = vintages[0];
    if (!vintage) {
      return {
        ok: false,
        error: `Data unavailable: FRED (${seriesId}) — no vintage dates returned`,
      };
    }
    const hash = resultHash({ seriesId, vintage, count: vintages.length });
    const span: EvidenceSpan = {
      id: spanId("econ-series", "get_vintage", hash),
      server: "econ-series",
      tool: "econ.get_vintage",
      citation: `FRED ${seriesId} latest vintage ${vintage}`,
      url: `https://fred.stlouisfed.org/series/${seriesId}`,
      seriesId,
      vintage,
      resultHash: hash,
    };
    return { ok: true, data: { seriesId, vintage, vintages, span }, spanId: span.id };
  } catch (error) {
    const msg =
      error instanceof DataUnavailableError
        ? error.message
        : error instanceof Error
          ? `Data unavailable: FRED (${seriesId}) — ${error.message}`
          : `Data unavailable: FRED (${seriesId}) — vintage request failed`;
    return { ok: false, error: msg };
  }
}
