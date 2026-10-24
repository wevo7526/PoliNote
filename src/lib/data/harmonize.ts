import { fredProvider } from "./fred";
import {
  DataUnavailableError,
  type AggregationMethod,
  type FetchedSeriesBundle,
  type ObservationPoint,
} from "./types";

export type HarmonizationReport = {
  inputSeriesId: string;
  targetFrequency?: "m" | "q" | "a";
  aggregationMethod?: AggregationMethod;
  deflatorSeriesId?: "PCEPI" | "GDPDEF";
  deflatorBaseYear?: string;
  normalizationMode?: "none" | "per_capita" | "share_of_gdp";
  missingValuesDropped: number;
  interpolatedGaps: number;
  notes: string[];
};

function bucketKey(dateStr: string, targetFreq: "m" | "q" | "a"): string {
  const year = dateStr.slice(0, 4);
  const month = Number.parseInt(dateStr.slice(5, 7) || "1", 10);
  if (targetFreq === "a") return `${year}-01-01`;
  if (targetFreq === "q") {
    const qStartMonth = String(Math.floor((month - 1) / 3) * 3 + 1).padStart(2, "0");
    return `${year}-${qStartMonth}-01`;
  }
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

/**
 * Explicitly converts observation frequency using a stated aggregation method (avg, sum, eop).
 */
export function convertFrequency(
  points: ObservationPoint[],
  targetFreq: "m" | "q" | "a",
  method: AggregationMethod = "avg",
): ObservationPoint[] {
  const groups = new Map<string, ObservationPoint[]>();
  for (const pt of points) {
    if (!Number.isFinite(pt.value)) continue;
    const key = bucketKey(pt.date, targetFreq);
    const list = groups.get(key) ?? [];
    list.push(pt);
    groups.set(key, list);
  }

  const out: ObservationPoint[] = [];
  for (const [periodDate, items] of [...groups.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    if (items.length === 0) continue;
    let value: number;
    if (method === "sum") {
      value = items.reduce((acc, x) => acc + x.value, 0);
    } else if (method === "eop") {
      value = items[items.length - 1]!.value;
    } else {
      value = items.reduce((acc, x) => acc + x.value, 0) / items.length;
    }
    out.push({
      date: periodDate,
      value,
      realtimeStart: items[items.length - 1]?.realtimeStart,
      realtimeEnd: items[items.length - 1]?.realtimeEnd,
    });
  }
  return out;
}

/**
 * Deflates a nominal series using a live-fetched deflator series (PCEPI or GDPDEF)
 * re-indexed to the requested base year (e.g. "2017" or the latest complete year).
 */
export async function deflateSeriesLive(
  bundle: FetchedSeriesBundle,
  options: {
    deflatorSeriesId?: "PCEPI" | "GDPDEF";
    baseYear?: string;
  } = {},
): Promise<{ bundle: FetchedSeriesBundle; deflatorBundle: FetchedSeriesBundle }> {
  const deflatorId = options.deflatorSeriesId ?? "PCEPI";
  const deflatorBundle = await fredProvider.observations(deflatorId, {
    start: bundle.provenance.observationWindow.start,
    end: bundle.provenance.observationWindow.end,
  });

  const baseYear =
    options.baseYear ??
    deflatorBundle.observations[deflatorBundle.observations.length - 1]!.date.slice(0, 4);
  const baseYearPts = deflatorBundle.observations.filter((p) =>
    p.date.startsWith(baseYear),
  );
  if (baseYearPts.length === 0) {
    throw new DataUnavailableError(
      "fred",
      `Deflator ${deflatorId} has no observations in base year ${baseYear}`,
    );
  }
  const baseIndex =
    baseYearPts.reduce((acc, p) => acc + p.value, 0) / baseYearPts.length;

  const deflatorByMonth = new Map<string, number>();
  for (const pt of deflatorBundle.observations) {
    deflatorByMonth.set(pt.date.slice(0, 7), pt.value);
  }

  const deflatedObs: ObservationPoint[] = [];
  for (const pt of bundle.observations) {
    const ym = pt.date.slice(0, 7);
    const qKey = bucketKey(pt.date, "q").slice(0, 7);
    const defVal = deflatorByMonth.get(ym) ?? deflatorByMonth.get(qKey);
    if (!defVal || defVal <= 0) continue;
    deflatedObs.push({
      ...pt,
      value: (pt.value / defVal) * baseIndex,
    });
  }

  if (deflatedObs.length === 0) {
    throw new DataUnavailableError(
      "fred",
      `Could not align ${bundle.metadata.id} dates with live deflator ${deflatorId}`,
    );
  }

  return {
    deflatorBundle,
    bundle: {
      ...bundle,
      observations: deflatedObs,
      provenance: {
        ...bundle.provenance,
        units: `${bundle.provenance.units} (Real ${baseYear} Dollars, deflated via ${deflatorId})`,
        transform: `${bundle.provenance.transform}; deflated with ${deflatorId} (${baseYear}=100)`,
        deflatedWith: {
          deflatorSeriesId: deflatorId,
          baseYear,
        },
      },
    },
  };
}

/**
 * Normalizes a series per capita (using live FRED POPTHM) or as a share of GDP (using live FRED GDP).
 */
export async function normalizeSeriesLive(
  bundle: FetchedSeriesBundle,
  mode: "per_capita" | "share_of_gdp",
): Promise<{ bundle: FetchedSeriesBundle; denominatorBundle: FetchedSeriesBundle }> {
  const denomId = mode === "per_capita" ? "POPTHM" : "GDP";
  const denominatorBundle = await fredProvider.observations(denomId, {
    start: bundle.provenance.observationWindow.start,
    end: bundle.provenance.observationWindow.end,
  });

  const denomByYm = new Map<string, number>();
  for (const pt of denominatorBundle.observations) {
    denomByYm.set(pt.date.slice(0, 7), pt.value);
  }

  const normalizedObs: ObservationPoint[] = [];
  for (const pt of bundle.observations) {
    const ym = pt.date.slice(0, 7);
    const qKey = bucketKey(pt.date, "q").slice(0, 7);
    const denom = denomByYm.get(ym) ?? denomByYm.get(qKey);
    if (!denom || denom <= 0) continue;
    const val =
      mode === "share_of_gdp" ? (pt.value / denom) * 100 : pt.value / denom;
    normalizedObs.push({
      ...pt,
      value: val,
    });
  }

  if (normalizedObs.length === 0) {
    throw new DataUnavailableError(
      "fred",
      `Could not align ${bundle.metadata.id} with live denominator ${denomId}`,
    );
  }

  return {
    denominatorBundle,
    bundle: {
      ...bundle,
      observations: normalizedObs,
      provenance: {
        ...bundle.provenance,
        units:
          mode === "share_of_gdp"
            ? `% of Nominal GDP (normalized via live ${denomId})`
            : `${bundle.provenance.units} per Capita (normalized via live ${denomId})`,
        transform: `${bundle.provenance.transform}; normalized (${mode} via ${denomId})`,
        normalizedWith: {
          denominatorSeriesId: denomId,
          mode,
        },
      },
    },
  };
}
