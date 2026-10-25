import { createSnapshotRecord, fetchLiveJsonWithSnapshot } from "./cache";
import {
  DataUnavailableError,
  type DataFrequency,
  type DataProvenance,
  type FetchedSeriesBundle,
  type FredUnitsTransform,
  type LiveDataProvider,
  type ObservationPoint,
  type ObservationsQuery,
  type SeriesMetadata,
} from "./types";

type FredSeriesRaw = {
  id?: string;
  title?: string;
  units?: string;
  units_short?: string;
  frequency?: string;
  frequency_short?: string;
  seasonal_adjustment?: string;
  seasonal_adjustment_short?: string;
  observation_start?: string;
  observation_end?: string;
  last_updated?: string;
  popularity?: number;
  notes?: string;
};

type FredObsRaw = {
  date?: string;
  value?: string;
  realtime_start?: string;
  realtime_end?: string;
};

const TRANSFORM_LABELS: Record<FredUnitsTransform, string> = {
  lin: "Levels (no transformation)",
  chg: "Change",
  ch1: "Change from year ago",
  pch: "Percent change",
  pc1: "Percent change from year ago",
  pca: "Compounded annual rate of change",
  cch: "Continuously compounded rate of change",
  cca: "Continuously compounded annual rate of change",
  log: "Natural log",
};

export function resolveFredKey(): string | null {
  const raw = process.env.FRED_API_KEY?.trim() ?? "";
  if (!raw) return null;
  const cleaned = raw
    .replace(/^['"]|['"]$/g, "")
    .replace(/^(?:FRED_API_KEY|api_key)\s*=\s*/i, "")
    .trim();
  if (!cleaned) return null;
  const match32 = cleaned.match(/[a-zA-Z0-9]{32}/);
  return (match32 ? match32[0] : cleaned).toLowerCase();
}

function normalizeFreqShort(freqShort?: string, freq?: string): DataFrequency {
  const raw = (freqShort || freq || "").trim().toLowerCase();
  if (raw.startsWith("d")) return "d";
  if (raw === "bw" || raw.startsWith("biw")) return "bw";
  if (raw.startsWith("w")) return "w";
  if (raw.startsWith("m")) return "m";
  if (raw.startsWith("q")) return "q";
  if (raw === "sa" || raw.startsWith("sem")) return "sa";
  if (raw.startsWith("a")) return "a";
  return "unknown";
}

function isCopyrightedNotes(notes?: string): boolean {
  if (!notes) return false;
  return /copyright|©|permission|proprietary|all rights reserved/i.test(notes);
}

function extractLicenseAttribution(notes?: string, title?: string): string {
  if (!notes) {
    return `Source: Federal Reserve Economic Data (FRED), St. Louis Fed${title ? ` — ${title}` : ""}. Public domain unless otherwise noted.`;
  }
  const lines = notes
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const copyrightLine = lines.find((l) =>
    /copyright|©|source:|suggested citation/i.test(l),
  );
  if (copyrightLine) {
    return copyrightLine.slice(0, 280);
  }
  return lines.slice(0, 2).join(" ").slice(0, 240);
}

function mapFredMetadata(
  raw: FredSeriesRaw,
  provider: "fred" | "alfred" = "fred",
): SeriesMetadata {
  const id = (raw.id ?? "").trim().toUpperCase();
  const title = (raw.title ?? id).trim();
  const notes = raw.notes?.trim();
  const discontinued =
    /discontinued/i.test(title) || /discontinued/i.test(notes ?? "");
  const copyrightedThirdParty = isCopyrightedNotes(notes);
  return {
    provider,
    id,
    title,
    units: raw.units ?? "Units",
    unitsShort: raw.units_short,
    frequency: raw.frequency ?? "Unknown",
    frequencyShort: normalizeFreqShort(raw.frequency_short, raw.frequency),
    seasonalAdjustment: raw.seasonal_adjustment ?? "Not Seasonally Adjusted",
    seasonalAdjustmentShort: raw.seasonal_adjustment_short,
    observationStart: raw.observation_start ?? "",
    observationEnd: raw.observation_end ?? "",
    lastUpdated: raw.last_updated ?? "",
    popularity: typeof raw.popularity === "number" ? raw.popularity : undefined,
    notes,
    discontinued,
    copyrightedThirdParty,
    licenseAttribution: extractLicenseAttribution(notes, title),
    sourceUrl:
      provider === "alfred"
        ? `https://alfred.stlouisfed.org/series?id=${encodeURIComponent(id)}`
        : `https://fred.stlouisfed.org/series/${encodeURIComponent(id)}`,
  };
}

function buildFredEndpointUrl(
  path: string,
  params: Record<string, string | undefined>,
  source: "fred" | "alfred" = "fred",
): string {
  const apiKey = resolveFredKey();
  if (!apiKey) {
    throw new DataUnavailableError(
      source,
      "FRED_API_KEY is not configured in the environment",
    );
  }
  const url = new URL(`https://api.stlouisfed.org/fred/${path}`);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("file_type", "json");
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") {
      url.searchParams.set(k, v);
    }
  }
  return url.toString();
}

function inferFrequencyFromDates(pts: ObservationPoint[]): {
  frequency: string;
  frequencyShort: DataFrequency;
} {
  if (pts.length < 3) {
    return { frequency: "Reported", frequencyShort: "unknown" };
  }
  const d0 = new Date(pts[pts.length - 2]!.date).getTime();
  const d1 = new Date(pts[pts.length - 1]!.date).getTime();
  const diffDays = Math.abs(d1 - d0) / (1000 * 60 * 60 * 24);
  if (diffDays <= 3) return { frequency: "Daily", frequencyShort: "d" };
  if (diffDays <= 10) return { frequency: "Weekly", frequencyShort: "w" };
  if (diffDays <= 40) return { frequency: "Monthly", frequencyShort: "m" };
  if (diffDays <= 110) return { frequency: "Quarterly", frequencyShort: "q" };
  return { frequency: "Annual", frequencyShort: "a" };
}

function applyUnitsTransformToPoints(
  pts: ObservationPoint[],
  transform: FredUnitsTransform,
): ObservationPoint[] {
  if (transform === "lin") return pts;
  if (transform === "log") {
    return pts
      .filter((p) => p.value > 0)
      .map((p) => ({ ...p, value: +Math.log(p.value).toFixed(6) }));
  }
  if (transform === "chg") {
    return pts.slice(1).map((p, i) => ({
      ...p,
      value: +(p.value - pts[i]!.value).toFixed(6),
    }));
  }
  if (transform === "pch" || transform === "pc1" || transform === "pca") {
    return pts.slice(1).map((p, i) => {
      const prev = pts[i]!.value;
      const pct = prev !== 0 ? ((p.value - prev) / Math.abs(prev)) * 100 : 0;
      return { ...p, value: +pct.toFixed(6) };
    });
  }
  return pts;
}

/**
 * Fetches live observations directly from St. Louis Fed's official public CSV endpoint
 * (`https://fred.stlouisfed.org/graph/fredgraph.csv?id=<SERIES_ID>`) when `FRED_API_KEY`
 * is not configured in the environment. Zero hardcoded or cached data; every observation
 * is pulled live from `fred.stlouisfed.org` at run time and hashed with SHA-256.
 */
async function fetchFredPublicCsvBundle(
  seriesId: string,
  options: ObservationsQuery = {},
): Promise<FetchedSeriesBundle> {
  const cleanId = seriesId.trim().toUpperCase();
  const csvUrl = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(cleanId)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch(csvUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "PoliNote/2.0 (https://polinote.vercel.app)",
      },
    });
    if (!response.ok) {
      throw new DataUnavailableError(
        "fred",
        `FRED series ${cleanId} returned HTTP ${response.status}`,
      );
    }

    const rawCsv = await response.text();
    const lines = rawCsv
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length < 2 || !/^observation_date|^DATE/i.test(lines[0]!)) {
      throw new DataUnavailableError(
        "fred",
        `FRED series ${cleanId} returned an invalid CSV payload`,
      );
    }

    let pts: ObservationPoint[] = [];
    for (let i = 1; i < lines.length; i += 1) {
      const [dateStr, valStr] = lines[i]!.split(",");
      if (!dateStr || !valStr || valStr === ".") continue;
      const val = Number.parseFloat(valStr);
      if (!Number.isFinite(val)) continue;
      if (options.start && dateStr < options.start) continue;
      if (options.end && dateStr > options.end) continue;
      pts.push({ date: dateStr, value: val });
    }

    const transform: FredUnitsTransform = options.units ?? "lin";
    pts = applyUnitsTransformToPoints(pts, transform);

    if (pts.length === 0) {
      throw new DataUnavailableError(
        "fred",
        `Series ${cleanId} returned 0 valid observations for window ${options.start ?? "start"} to ${options.end ?? "latest"}`,
      );
    }

    const freqInfo = inferFrequencyFromDates(pts);
    const firstDate = pts[0]!.date;
    const lastDate = pts[pts.length - 1]!.date;
    const snapshot = createSnapshotRecord({
      provider: "fred",
      seriesId: cleanId,
      requestUrl: csvUrl,
      rawJson: rawCsv,
    });

    const sourceUrl = `https://fred.stlouisfed.org/series/${encodeURIComponent(cleanId)}`;
    const metadata: SeriesMetadata = {
      provider: "fred",
      id: cleanId,
      title: `FRED Series ${cleanId}`,
      units:
        transform === "lin"
          ? "Official FRED Units"
          : `Official FRED Units (${TRANSFORM_LABELS[transform]})`,
      frequency: freqInfo.frequency,
      frequencyShort: freqInfo.frequencyShort,
      seasonalAdjustment: "Reported by St. Louis Fed (FRED)",
      observationStart: firstDate,
      observationEnd: lastDate,
      lastUpdated: lastDate,
      discontinued: false,
      copyrightedThirdParty: false,
      licenseAttribution:
        "Source: Federal Reserve Economic Data (FRED), Federal Reserve Bank of St. Louis.",
      sourceUrl,
    };

    const provenance: DataProvenance = {
      source: "fred",
      seriesId: cleanId,
      title: metadata.title,
      units: metadata.units,
      transform: `${transform} — ${TRANSFORM_LABELS[transform]}`,
      seasonalAdjustment: metadata.seasonalAdjustment,
      frequency: metadata.frequency,
      observationWindow: { start: firstDate, end: lastDate },
      vintageDate: lastDate,
      lastUpdated: lastDate,
      retrievedAt: snapshot.retrievedAt,
      url: sourceUrl,
      licenseAttribution: metadata.licenseAttribution,
      copyrightedThirdParty: false,
      payloadSha256: snapshot.sha256,
    };

    return {
      metadata,
      observations: pts,
      provenance,
      snapshot,
      vintages: [lastDate],
    };
  } catch (error) {
    if (error instanceof DataUnavailableError) throw error;
    throw new DataUnavailableError(
      "fred",
      error instanceof Error ? error.message : "FRED live pull failed",
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchFredVintageDates(
  seriesId: string,
  limit = 20,
  asOfDate?: string,
): Promise<string[]> {
  const cleanId = seriesId.trim().toUpperCase();
  if (!resolveFredKey()) {
    const bundle = await fetchFredPublicCsvBundle(cleanId);
    return bundle.vintages ?? [];
  }
  const url = buildFredEndpointUrl(
    "series/vintagedates",
    {
      series_id: cleanId,
      sort_order: "desc",
      limit: String(limit),
      realtime_end: asOfDate,
    },
    asOfDate ? "alfred" : "fred",
  );
  const { data } = await fetchLiveJsonWithSnapshot<{
    vintage_dates?: string[];
  }>({
    provider: asOfDate ? "alfred" : "fred",
    seriesId: cleanId,
    url,
  });
  return data.vintage_dates ?? [];
}

export class FredDataProvider implements LiveDataProvider {
  readonly id: "fred" | "alfred";
  readonly displayName: string;

  constructor(mode: "fred" | "alfred" = "fred") {
    this.id = mode;
    this.displayName =
      mode === "alfred"
        ? "ALFRED (Archival Federal Reserve Economic Data)"
        : "FRED (Federal Reserve Economic Data, St. Louis Fed)";
  }

  isConfigured(): boolean {
    return Boolean(resolveFredKey());
  }

  async search(query: string, limit = 12): Promise<SeriesMetadata[]> {
    const cleaned = query.trim();
    if (!cleaned) {
      throw new DataUnavailableError(this.id, "Search query is required");
    }
    if (!resolveFredKey()) {
      throw new DataUnavailableError(
        this.id,
        "FRED_API_KEY is not configured for free-text catalog search; direct FRED series IDs are fetched live via fredgraph.csv",
      );
    }
    const url = buildFredEndpointUrl(
      "series/search",
      {
        search_text: cleaned,
        limit: String(limit),
        order_by: "search_rank",
        sort_order: "desc",
      },
      this.id,
    );
    const { data } = await fetchLiveJsonWithSnapshot<{
      seriess?: FredSeriesRaw[];
    }>({
      provider: this.id,
      seriesId: `search_${cleaned.slice(0, 24)}`,
      url,
    });
    return (data.seriess ?? [])
      .filter((row) => Boolean(row.id && row.title))
      .map((row) => mapFredMetadata(row, this.id));
  }

  async metadata(id: string): Promise<SeriesMetadata> {
    const cleanId = id.trim().toUpperCase();
    if (!cleanId) {
      throw new DataUnavailableError(this.id, "Series ID is required");
    }
    if (!resolveFredKey()) {
      const bundle = await fetchFredPublicCsvBundle(cleanId);
      return bundle.metadata;
    }
    const url = buildFredEndpointUrl(
      "series",
      { series_id: cleanId },
      this.id,
    );
    const { data } = await fetchLiveJsonWithSnapshot<{
      seriess?: FredSeriesRaw[];
    }>({
      provider: this.id,
      seriesId: cleanId,
      url,
    });
    const first = data.seriess?.[0];
    if (!first) {
      throw new DataUnavailableError(
        this.id,
        `Series ${cleanId} was not found on FRED`,
      );
    }
    return mapFredMetadata(first, this.id);
  }

  async observations(
    id: string,
    options: ObservationsQuery = {},
  ): Promise<FetchedSeriesBundle> {
    const cleanId = id.trim().toUpperCase();
    if (!cleanId) {
      throw new DataUnavailableError(this.id, "Series ID is required");
    }

    if (!resolveFredKey()) {
      return fetchFredPublicCsvBundle(cleanId, options);
    }

    const transform: FredUnitsTransform = options.units ?? "lin";
    const isRealtime = Boolean(
      this.id === "alfred" ||
        options.realtimeStart ||
        options.realtimeEnd ||
        options.outputType === 4 ||
        (options.vintageDates && options.vintageDates.length > 0),
    );
    const providerId = isRealtime ? "alfred" : "fred";

    const obsUrl = buildFredEndpointUrl(
      "series/observations",
      {
        series_id: cleanId,
        observation_start: options.start,
        observation_end: options.end,
        units: transform,
        frequency: options.frequency,
        aggregation_method: options.aggregation,
        realtime_start: options.realtimeStart,
        realtime_end: options.realtimeEnd,
        vintage_dates: options.vintageDates?.join(","),
        output_type: options.outputType ? String(options.outputType) : undefined,
        sort_order: "asc",
      },
      providerId,
    );

    const [meta, { data, snapshot }, vintages] = await Promise.all([
      this.metadata(cleanId),
      fetchLiveJsonWithSnapshot<{
        realtime_start?: string;
        realtime_end?: string;
        observations?: FredObsRaw[];
      }>({
        provider: providerId,
        seriesId: cleanId,
        url: obsUrl,
      }),
      fetchFredVintageDates(cleanId, 5, options.realtimeEnd).catch(() => []),
    ]);

    const observations: ObservationPoint[] = (data.observations ?? [])
      .filter(
        (row) =>
          row.date &&
          row.value !== undefined &&
          row.value !== "." &&
          Number.isFinite(Number.parseFloat(row.value)),
      )
      .map((row) => ({
        date: row.date!,
        value: Number.parseFloat(row.value!),
        realtimeStart: row.realtime_start,
        realtimeEnd: row.realtime_end,
      }));

    if (observations.length === 0) {
      throw new DataUnavailableError(
        providerId,
        `Series ${cleanId} returned 0 valid observations for window ${options.start ?? "start"} to ${options.end ?? "latest"}`,
      );
    }

    const firstDate = observations[0]!.date;
    const lastDate = observations[observations.length - 1]!.date;
    const vintageMode =
      options.outputType === 4
        ? "initial_release"
        : options.realtimeEnd || options.realtimeStart
          ? "realtime_as_of"
          : "latest_revised";

    const provenance: DataProvenance = {
      source: providerId,
      seriesId: cleanId,
      title: meta.title,
      units:
        transform === "lin"
          ? meta.units
          : `${meta.units} (${TRANSFORM_LABELS[transform]})`,
      transform: `${transform} — ${TRANSFORM_LABELS[transform]}`,
      seasonalAdjustment: meta.seasonalAdjustment,
      frequency: options.frequency
        ? `${options.frequency.toUpperCase()} (${options.aggregation ?? "avg"})`
        : meta.frequency,
      observationWindow: {
        start: firstDate,
        end: lastDate,
      },
      realtimeWindow: {
        realtimeStart:
          data.realtime_start ??
          options.realtimeStart ??
          new Date().toISOString().slice(0, 10),
        realtimeEnd:
          data.realtime_end ??
          options.realtimeEnd ??
          new Date().toISOString().slice(0, 10),
        outputType: options.outputType,
        vintageMode,
      },
      vintageDate:
        vintages[0] ?? data.realtime_end ?? meta.lastUpdated.slice(0, 10),
      lastUpdated: meta.lastUpdated,
      retrievedAt: snapshot.retrievedAt,
      url: meta.sourceUrl,
      licenseAttribution: meta.licenseAttribution,
      copyrightedThirdParty: meta.copyrightedThirdParty,
      payloadSha256: snapshot.sha256,
    };

    return {
      metadata: meta,
      observations,
      provenance,
      snapshot,
      vintages,
    };
  }
}

export const fredProvider = new FredDataProvider("fred");
export const alfredProvider = new FredDataProvider("alfred");
