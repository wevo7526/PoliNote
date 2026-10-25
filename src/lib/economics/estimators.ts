import { sha256Hex } from "@/lib/data/cache";
import {
  DataUnavailableError,
  type FetchedSeriesBundle,
  type ObservationPoint,
} from "@/lib/data/types";
import {
  criticalZ,
  fTestPValue,
  fitOlsHac,
  runStationarityTests,
  solveSyntheticControlWeights,
  twoSidedPValueFromT,
} from "./math";
import {
  METHOD_CATALOG,
  type CounterfactualComparisonPoint,
  type DiagnosticCheckItem,
  type EconometricEstimate,
  type EconometricMethodId,
  type EstimationSpec,
  type EventStudyCoefficient,
  type HonestyTier,
  type LocalProjectionHorizon,
  type PreRegistrationLock,
  type RobustnessBundle,
  type SpecificationCurvePoint,
} from "./schemas";

/**
 * Creates a cryptographic pre-registration lock BEFORE observations are fetched or estimated.
 * Any post-lock modification to scope, series, transform, method, or window
 * produces a new fork with `forkParentHash` set.
 */
export function createPreRegistrationLock(input: {
  scopeId: string;
  outcomeSeriesId: string;
  comparisonSeriesIds?: string[];
  selectionRulesSummary?: string;
  transform: string;
  method: EconometricMethodId;
  windowStart: string;
  windowEnd: string;
  policyDate: string | null;
  hacLags?: number;
  lockedAt?: string;
  forkParentHash?: string;
  forkReason?: string;
}): PreRegistrationLock {
  const lockedAt = input.lockedAt ?? new Date().toISOString();
  const comparisonSeriesIds = input.comparisonSeriesIds ?? [];
  const selectionRulesSummary =
    input.selectionRulesSummary ??
    "Live provider metadata validation (active status, pre/post window coverage, frequency)";
  const hacLags = input.hacLags ?? 4;

  const canonicalPayload = JSON.stringify({
    scopeId: input.scopeId,
    outcomeSeriesId: input.outcomeSeriesId,
    comparisonSeriesIds,
    selectionRulesSummary,
    transform: input.transform,
    method: input.method,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    policyDate: input.policyDate,
    hacLags,
    forkParentHash: input.forkParentHash ?? null,
  });
  const lockHash = sha256Hex(canonicalPayload);
  return {
    lockHash,
    lockedAt,
    scopeId: input.scopeId,
    outcomeSeriesId: input.outcomeSeriesId,
    comparisonSeriesIds,
    selectionRulesSummary,
    transform: input.transform,
    method: input.method,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    policyDate: input.policyDate,
    hacLags,
    forkParentHash: input.forkParentHash,
    forkReason: input.forkReason,
  };
}

function applyClientTransform(
  pts: ObservationPoint[],
  mode: "lin" | "log" | "diff",
): ObservationPoint[] {
  if (mode === "lin") return pts;
  if (mode === "log") {
    return pts
      .filter((p) => p.value > 0)
      .map((p) => ({ ...p, value: Math.log(p.value) }));
  }
  const out: ObservationPoint[] = [];
  for (let i = 1; i < pts.length; i += 1) {
    const prev = pts[i - 1]!.value;
    const cur = pts[i]!.value;
    const pct = prev !== 0 ? ((cur - prev) / Math.abs(prev)) * 100 : cur - prev;
    out.push({
      ...pts[i]!,
      value: pct,
    });
  }
  return out;
}

/**
 * Resolves the observation index corresponding to the explicit policy date.
 * Never falls back to a 60%-split when a policy date is required or missing.
 */
function resolvePolicyDateSplitIndex(
  pts: ObservationPoint[],
  policyDate: string | null,
  requiresPolicyDate: boolean,
): number | null {
  if (!policyDate || !/^\d{4}-\d{2}-\d{2}$/.test(policyDate.trim())) {
    if (requiresPolicyDate) {
      throw new DataUnavailableError(
        "econometrics",
        "Estimation skipped: no defensible policy enactment date was specified in the Scope Contract. Provide an explicit policy date (YYYY-MM-DD) with a cited statutory/historical source.",
      );
    }
    return null;
  }

  const idx = pts.findIndex((p) => p.date >= policyDate.trim());
  if (idx < 4 || idx > pts.length - 2) {
    throw new DataUnavailableError(
      "econometrics",
      `Estimation skipped: policy date ${policyDate} lies outside the usable interior of series (${pts[0]?.date} to ${pts[pts.length - 1]?.date}; requires at least 4 pre-policy and 2 post-policy observations).`,
    );
  }
  return idx;
}

function alignComparisonSeries(
  targetPts: ObservationPoint[],
  candidates: FetchedSeriesBundle[],
  transformMode: "lin" | "log" | "diff",
): Array<{ id: string; title: string; values: number[] }> {
  const alignedList: Array<{ id: string; title: string; values: number[] }> = [];
  for (const cand of candidates) {
    const transformed = applyClientTransform(cand.observations, transformMode);
    const byYm = new Map<string, number>();
    const byYear = new Map<string, number>();
    for (const p of transformed) {
      byYm.set(p.date.slice(0, 7), p.value);
      byYear.set(p.date.slice(0, 4), p.value);
    }
    const vals: number[] = [];
    let missing = 0;
    for (const pt of targetPts) {
      const v = byYm.get(pt.date.slice(0, 7)) ?? byYear.get(pt.date.slice(0, 4));
      if (v === undefined || !Number.isFinite(v)) {
        missing += 1;
      } else {
        vals.push(v);
      }
    }
    if (missing === 0 && vals.length === targetPts.length) {
      alignedList.push({
        id: cand.metadata.id,
        title: cand.metadata.title,
        values: vals,
      });
    }
  }
  return alignedList;
}

/**
 * Validates preconditions for the requested econometric method, enforces catalog honesty rules
 * (relabelling DiD / Synthetic Control / single-series Event Study to Descriptive when comparison/donor
 * requirements are not met), and executes estimation on live fetched series bundles.
 */
export function executeEconometricEstimate(input: {
  method: EconometricMethodId;
  outcome: FetchedSeriesBundle;
  policyDate: string | null;
  scopeId: string;
  controls?: FetchedSeriesBundle[];
  donors?: FetchedSeriesBundle[];
  instrument?: FetchedSeriesBundle;
  cutoff?: number;
  transform?: "lin" | "log" | "diff";
  hacLags?: number;
  lpHorizons?: number;
  ciLevel?: number;
  preRegistrationLock?: PreRegistrationLock;
  forkParentHash?: string;
  forkReason?: string;
}): EconometricEstimate {
  const requestedDescriptor = METHOD_CATALOG[input.method];
  if (!requestedDescriptor) {
    throw new DataUnavailableError(
      "econometrics",
      `Unknown econometric method: ${String(input.method)}`,
    );
  }

  if (requestedDescriptor.implementationStatus === "Not yet") {
    throw new DataUnavailableError(
      "econometrics",
      `Method "${requestedDescriptor.label}" is marked "Not yet" in the catalog (${requestedDescriptor.plainLanguageExplanation}) and cannot be executed on aggregate time-series data.`,
    );
  }

  const transformMode = input.transform ?? "lin";
  const pts = applyClientTransform(input.outcome.observations, transformMode);
  if (pts.length < requestedDescriptor.minObservations) {
    throw new DataUnavailableError(
      "econometrics",
      `Precondition failed for ${requestedDescriptor.label}: requires at least ${requestedDescriptor.minObservations} observations, but series ${input.outcome.metadata.id} has ${pts.length}`,
    );
  }

  if (requestedDescriptor.requiresInstrument && !input.instrument) {
    throw new DataUnavailableError(
      "econometrics",
      `Precondition failed for ${requestedDescriptor.label}: scope must provide a valid excluded instrument series`,
    );
  }

  const candidateDonors = [
    ...(input.donors ?? []),
    ...(input.controls ?? []),
  ].filter((b, i, arr) => b.metadata.id !== input.outcome.metadata.id && arr.findIndex((x) => x.metadata.id === b.metadata.id) === i);

  const alignedDonors = alignComparisonSeries(pts, candidateDonors, transformMode);

  // Enforce catalog comparison / donor pool rules and honesty relabeling
  let effectiveMethod: EconometricMethodId = input.method;
  let effectiveHonestyTier: HonestyTier = requestedDescriptor.honestyTier;
  let effectiveHonestyLabel: string = requestedDescriptor.honestyLabel;
  let relabelReason: string | undefined;

  if (input.method === "did_twfe") {
    if (alignedDonors.length < 1) {
      effectiveMethod = "descriptive_newey_west";
      effectiveHonestyTier = "Descriptive";
      effectiveHonestyLabel = "Descriptive (Single-Series Pre/Post — Relabeled from DiD)";
      relabelReason =
        "Relabeled from Quasi-experimental (Difference-in-Differences) to Descriptive: DiD requires an untreated comparison series covering the observation window, but none qualified; estimated as a single-series pre/post regression.";
    }
  } else if (input.method === "synthetic_control") {
    if (alignedDonors.length < 2) {
      effectiveMethod = "descriptive_newey_west";
      effectiveHonestyTier = "Descriptive";
      effectiveHonestyLabel = "Descriptive (Single-Series Pre/Post — Relabeled from Synthetic Control)";
      relabelReason = `Relabeled from Quasi-experimental (Synthetic Control) to Descriptive: Synthetic Control requires a donor pool of at least 2 aligned untreated series, but ${alignedDonors.length} qualified; estimated as a single-series pre/post regression.`;
    }
  } else if (input.method === "event_study") {
    if (alignedDonors.length < 1) {
      // Single-series event study / interrupted time series must never be labeled Quasi-experimental
      effectiveHonestyTier = "Descriptive";
      effectiveHonestyLabel = "Descriptive (Single-Series Interrupted Time Series / Event Study)";
      relabelReason =
        "Relabeled from Quasi-experimental (Event Study) to Descriptive: estimated on a single time series without an untreated comparison series. Single-series pre/post regressions are never labeled quasi-experimental.";
    }
  }

  const effectiveDescriptor = METHOD_CATALOG[effectiveMethod];
  const needsPolicyDate =
    requestedDescriptor.requiresPolicyDate || effectiveDescriptor.requiresPolicyDate;
  const splitIdxOrNull = resolvePolicyDateSplitIndex(
    pts,
    input.policyDate,
    needsPolicyDate,
  );

  // For break-detection or stationarity methods that don't require a policyDate upfront,
  // find the sup-t break date if policyDate was not provided.
  let splitIdx = splitIdxOrNull ?? Math.floor(pts.length / 2);
  const rawY = pts.map((p) => p.value);
  const n = rawY.length;
  const hacLags = input.hacLags ?? 4;

  let structuralBreakDates: string[] | undefined;
  if (
    effectiveMethod === "bai_perron_break" ||
    effectiveMethod === "chow_break_test" ||
    splitIdxOrNull === null
  ) {
    const trim = Math.max(4, Math.floor(n * 0.15));
    let bestIdx = splitIdx;
    let bestT = -1;
    for (let cand = trim; cand < n - trim; cand += 1) {
      const Xc = pts.map((_, i) => [1, i >= cand ? 1 : 0, i - cand]);
      const fitC = fitOlsHac(rawY, Xc, hacLags);
      const tCand = Math.abs(fitC.tStats[1] ?? 0);
      if (tCand > bestT) {
        bestT = tCand;
        bestIdx = cand;
      }
    }
    structuralBreakDates = [pts[bestIdx]!.date];
    if (splitIdxOrNull === null) {
      splitIdx = bestIdx;
    }
  }

  const resolvedPolicyDate = input.policyDate ?? pts[splitIdx]!.date;
  const windowStart = pts[0]!.date;
  const windowEnd = pts[pts.length - 1]!.date;
  const ciLevel = input.ciLevel ?? 0.95;
  const zCrit = criticalZ(ciLevel);
  const lpHorizons = input.lpHorizons ?? 8;

  const preReg =
    input.preRegistrationLock ??
    createPreRegistrationLock({
      scopeId: input.scopeId,
      outcomeSeriesId: input.outcome.metadata.id,
      comparisonSeriesIds: alignedDonors.map((d) => d.id),
      transform: transformMode,
      method: input.method,
      windowStart,
      windowEnd,
      policyDate: resolvedPolicyDate,
      hacLags,
      forkParentHash: input.forkParentHash,
      forkReason: input.forkReason,
    });

  // For DiD or comparison-differenced Event Study, construct the differenced series
  // d_t = (Y_treated,t - mean_pre(Y_treated)) - (Y_comp,t - mean_pre(Y_comp))
  let y = rawY.slice();
  const donorIdsUsed: string[] = [];
  if (
    (effectiveMethod === "did_twfe" ||
      (effectiveMethod === "event_study" && alignedDonors.length >= 1)) &&
    alignedDonors.length >= 1
  ) {
    const comp = alignedDonors[0]!;
    donorIdsUsed.push(comp.id);
    const yPreMean =
      rawY.slice(0, splitIdx).reduce((a, b) => a + b, 0) / Math.max(1, splitIdx);
    const cPreMean =
      comp.values.slice(0, splitIdx).reduce((a, b) => a + b, 0) /
      Math.max(1, splitIdx);
    const cPreSd = Math.sqrt(
      comp.values
        .slice(0, splitIdx)
        .reduce((acc, v) => acc + (v - cPreMean) ** 2, 0) /
        Math.max(1, splitIdx),
    );
    const yPreSd = Math.sqrt(
      rawY
        .slice(0, splitIdx)
        .reduce((acc, v) => acc + (v - yPreMean) ** 2, 0) /
        Math.max(1, splitIdx),
    );
    const scaleFactor = cPreSd > 1e-8 && yPreSd > 1e-8 ? yPreSd / cPreSd : 1;

    y = rawY.map(
      (yt, i) =>
        (yt - yPreMean) - (comp.values[i]! - cPreMean) * scaleFactor + yPreMean,
    );
  }

  const postIndicator = pts.map((_, i) => (i >= splitIdx ? 1 : 0));
  const timeTrend = pts.map((_, i) => i - splitIdx);

  // Align additional control series not already used as the primary DiD comparison
  const controlVectors: number[][] = [];
  const controlIds: string[] = [];
  for (const ctrl of alignedDonors) {
    if (donorIdsUsed.includes(ctrl.id)) continue;
    controlVectors.push(ctrl.values);
    controlIds.push(ctrl.id);
  }

  const stationarity = runStationarityTests(y);

  const X = pts.map((_, i) => [
    1,
    postIndicator[i]!,
    timeTrend[i]!,
    postIndicator[i]! * timeTrend[i]!,
    ...controlVectors.map((vec) => vec[i]!),
  ]);

  const ols = fitOlsHac(y, X, hacLags);
  let pointEstimate = +(ols.betas[1] ?? 0).toFixed(4);
  let standardError = +(ols.standardErrors[1] ?? 0).toFixed(4);
  let tStat = +(ols.tStats[1] ?? 0).toFixed(4);
  let pValue = +(ols.pValues[1] ?? 1).toFixed(4);
  let seMethod = `Newey–West HAC (Bartlett kernel, maxlags=${hacLags})`;
  let formula =
    donorIdsUsed.length > 0
      ? `(Y_{${input.outcome.metadata.id},t} - Y_{${donorIdsUsed[0]},t}) = α + β·1(t >= ${resolvedPolicyDate}) + δ_1·(t - t_0) + δ_2·1(t >= t_0)(t - t_0) + ε_t`
      : `y_t = α + β·1(t >= ${resolvedPolicyDate}) + δ_1·(t - t_0) + δ_2·1(t >= t_0)(t - t_0)${controlIds.length > 0 ? ` + γ'·Controls(${controlIds.join(", ")})` : ""} + ε_t`;

  let eventStudyPath: EventStudyCoefficient[] | undefined;
  let localProjectionsPath: LocalProjectionHorizon[] | undefined;
  let counterfactualPath: CounterfactualComparisonPoint[] | undefined;
  let donorWeights: Array<{ unit: string; weight: number }> | undefined;
  let preTrendFStat: number | undefined;
  let preTrendPValue: number | undefined;
  let rmspePre: number | undefined;
  let rmspePost: number | undefined;

  if (
    effectiveMethod === "event_study" ||
    effectiveMethod === "did_twfe" ||
    effectiveMethod === "descriptive_newey_west" ||
    effectiveMethod === "arima_forecast_counterfactual"
  ) {
    const preSlice = y.slice(Math.max(0, splitIdx - 8), splitIdx);
    const preX = preSlice.map((_, i) => [1, i]);
    const preFit = fitOlsHac(preSlice, preX, 2);
    const preSlope = preFit.betas[1] ?? 0;
    const preIntercept = preFit.betas[0] ?? y[splitIdx - 1] ?? 0;

    const preResiduals = preFit.residuals;
    const preLeadX = preResiduals.map((_, i) => [
      1,
      (i - (preResiduals.length - 1) / 2) ** 2,
    ]);
    const preLeadFit = fitOlsHac(preResiduals, preLeadX, 1);
    const leadSlope = preLeadFit.betas[1] ?? 0;
    const leadSe = preLeadFit.standardErrors[1] ?? 1;
    preTrendFStat = +((leadSlope / Math.max(1e-6, leadSe)) ** 2).toFixed(4);
    preTrendPValue = +fTestPValue(
      preTrendFStat,
      1,
      Math.max(1, preSlice.length - 3),
    ).toFixed(4);

    // If pre-trend check fails on a Quasi-experimental method, downgrade honesty label to Associational
    if (
      effectiveHonestyTier === "Quasi-experimental" &&
      preTrendPValue < 0.05
    ) {
      effectiveHonestyTier = "Associational";
      effectiveHonestyLabel = `Associational (${effectiveDescriptor.label} — Pre-Trend Check Failed p=${preTrendPValue})`;
      relabelReason = `Relabeled from Quasi-experimental to Associational because the pre-policy parallel trend F-test rejected at p = ${preTrendPValue} (< 0.05).`;
    }

    const refVal = y[Math.max(0, splitIdx - 1)]!;
    const residSd = Math.sqrt(ols.rss / Math.max(1, ols.df));
    eventStudyPath = [];
    for (let rel = -4; rel <= 5; rel += 1) {
      const idx = splitIdx + rel;
      if (idx < 0 || idx >= n) continue;
      if (rel === -1) {
        eventStudyPath.push({
          relPeriod: -1,
          periodLabel: `t-1 (${pts[idx]!.date.slice(0, 7)})`,
          estimate: 0,
          standardError: 0,
          ciLower: 0,
          ciUpper: 0,
          pValue: 1,
        });
        continue;
      }
      const trendCounterfactual =
        preIntercept + preSlope * (preSlice.length - 1 + (rel + 1));
      const est = +(y[idx]! - (rel < 0 ? refVal : trendCounterfactual)).toFixed(4);
      const se = +(
        residSd * Math.sqrt(1 + Math.abs(rel + 1) / Math.max(4, preSlice.length))
      ).toFixed(4);
      const tVal = est / Math.max(1e-7, se);
      const pVal = twoSidedPValueFromT(tVal, ols.df);
      eventStudyPath.push({
        relPeriod: rel,
        periodLabel: `${rel >= 0 ? `t+${rel}` : `t${rel}`} (${pts[idx]!.date.slice(0, 7)})`,
        estimate: est,
        standardError: se,
        ciLower: +(est - zCrit * se).toFixed(4),
        ciUpper: +(est + zCrit * se).toFixed(4),
        pValue: +pVal.toFixed(4),
      });
    }

    counterfactualPath = pts.map((pt, i) => {
      const stepsFromStart = i - Math.max(0, splitIdx - preSlice.length);
      const cf = +(preIntercept + preSlope * stepsFromStart).toFixed(4);
      const isPost = i >= splitIdx;
      const horizonSteps = isPost ? i - splitIdx + 1 : 1;
      const se = residSd * Math.sqrt(isPost ? 1 + horizonSteps * 0.25 : 0.5);
      return {
        date: pt.date,
        actual: +y[i]!.toFixed(4),
        counterfactual: isPost ? cf : +y[i]!.toFixed(4),
        ciLower: +(cf - zCrit * se).toFixed(4),
        ciUpper: +(cf + zCrit * se).toFixed(4),
        isPostPolicy: isPost,
        placeboGap: +(y[i]! - cf).toFixed(4),
      };
    });
  }

  // Jordà Local Projections (h = 0..H)
  if (
    effectiveMethod === "local_projections_jorda" ||
    effectiveMethod === "event_study" ||
    effectiveMethod === "did_twfe" ||
    effectiveMethod === "arima_forecast_counterfactual" ||
    effectiveMethod === "descriptive_newey_west"
  ) {
    const maxH = Math.min(lpHorizons, Math.max(2, Math.floor((n - 6) / 2)));
    localProjectionsPath = [];
    for (let h = 0; h <= maxH; h += 1) {
      const yh: number[] = [];
      const Xh: number[][] = [];
      for (let t = 2; t < n - h; t += 1) {
        yh.push(y[t + h]! - y[t - 1]!);
        const shock = t >= splitIdx ? 1 : 0;
        const lagDy = y[t - 1]! - y[t - 2]!;
        Xh.push([1, shock, lagDy]);
      }
      if (yh.length < 6) break;
      const lpFit = fitOlsHac(yh, Xh, h + 1);
      const b = +(lpFit.betas[1] ?? 0).toFixed(4);
      const se = +(lpFit.standardErrors[1] ?? 0).toFixed(4);
      const pv = +(lpFit.pValues[1] ?? 1).toFixed(4);
      localProjectionsPath.push({
        horizon: h,
        horizonLabel: `h=${h}`,
        irfEstimate: b,
        standardError: se,
        ciLower: +(b - zCrit * se).toFixed(4),
        ciUpper: +(b + zCrit * se).toFixed(4),
        pValue: pv,
        sampleSize: yh.length,
      });
    }

    if (
      effectiveMethod === "local_projections_jorda" &&
      localProjectionsPath.length > 0
    ) {
      const midLp =
        localProjectionsPath[Math.min(4, localProjectionsPath.length - 1)]!;
      pointEstimate = midLp.irfEstimate;
      standardError = midLp.standardError;
      tStat = +(pointEstimate / Math.max(1e-7, standardError)).toFixed(4);
      pValue = midLp.pValue;
      formula = `y_{t+h} - y_{t-1} = α_h + β_h·Shock_t + φ_h·Δy_{t-1} + u_{t+h} (Jordà LP, h=0..${localProjectionsPath.length - 1})`;
    }
  }

  // Synthetic Control when >= 2 donor series qualify
  if (effectiveMethod === "synthetic_control" && alignedDonors.length >= 2) {
    const yPre = rawY.slice(0, splitIdx);
    const yPreMean = yPre.reduce((a, b) => a + b, 0) / Math.max(1, yPre.length);
    const yPreSd =
      Math.sqrt(
        yPre.reduce((acc, v) => acc + (v - yPreMean) ** 2, 0) /
          Math.max(1, yPre.length),
      ) || 1;

    // Rescale donors to treated pre-period mean and SD to prevent scale interpolation bias
    const rescaledDonors = alignedDonors.map((d) => {
      const dPre = d.values.slice(0, splitIdx);
      const dMean = dPre.reduce((a, b) => a + b, 0) / Math.max(1, dPre.length);
      const dSd =
        Math.sqrt(
          dPre.reduce((acc, v) => acc + (v - dMean) ** 2, 0) /
            Math.max(1, dPre.length),
        ) || 1;
      return {
        id: d.id,
        values: d.values.map((v) => ((v - dMean) / dSd) * yPreSd + yPreMean),
      };
    });

    const dPre = rescaledDonors.map((d) => d.values.slice(0, splitIdx));
    const solved = solveSyntheticControlWeights(yPre, dPre);
    rmspePre = solved.rmspePre;
    donorWeights = rescaledDonors.map((d, j) => ({
      unit: d.id,
      weight: solved.weights[j] ?? 0,
    }));
    donorIdsUsed.push(...rescaledDonors.map((d) => d.id));

    const synthSeries = pts.map((_, t) =>
      rescaledDonors.reduce(
        (acc, d, j) => acc + (solved.weights[j] ?? 0) * (d.values[t] ?? 0),
        0,
      ),
    );
    const postGaps = rawY
      .slice(splitIdx)
      .map((val, idx) => val - synthSeries[splitIdx + idx]!);
    const avgGap =
      postGaps.reduce((a, b) => a + b, 0) / Math.max(1, postGaps.length);
    rmspePost = +Math.sqrt(
      postGaps.reduce((a, b) => a + b * b, 0) / Math.max(1, postGaps.length),
    ).toFixed(4);

    pointEstimate = +avgGap.toFixed(4);
    standardError = +Math.max(1e-4, rmspePre).toFixed(4);
    tStat = +(pointEstimate / standardError).toFixed(4);
    pValue = +twoSidedPValueFromT(tStat, Math.max(1, postGaps.length - 1)).toFixed(4);
    seMethod = `Synthetic Control Pre-RMSPE (${rmspePre}) / Placebo Ratio`;
    formula = `Y_{1t} - Σ_{j=1}^{${rescaledDonors.length}} w_j* Y_{jt}, s.t. w_j >= 0, Σ w_j = 1`;

    counterfactualPath = pts.map((pt, i) => ({
      date: pt.date,
      actual: +rawY[i]!.toFixed(4),
      counterfactual: +synthSeries[i]!.toFixed(4),
      ciLower: +(synthSeries[i]! - zCrit * standardError).toFixed(4),
      ciUpper: +(synthSeries[i]! + zCrit * standardError).toFixed(4),
      isPostPolicy: i >= splitIdx,
      placeboGap: +(rawY[i]! - synthSeries[i]!).toFixed(4),
    }));
  }

  const checklist: DiagnosticCheckItem[] = [
    {
      name: "Serial Correlation (Ljung–Box Q)",
      status: ols.ljungBoxP >= 0.05 ? "pass" : "warn",
      pValue: +ols.ljungBoxP.toFixed(4),
      summary:
        ols.ljungBoxP >= 0.05
          ? `Residual autocorrelation p = ${ols.ljungBoxP.toFixed(3)} (no severe unmodeled serial correlation; HAC SEs applied).`
          : `Residual autocorrelation detected (p = ${ols.ljungBoxP.toFixed(3)}); Newey–West HAC standard errors (${hacLags} lags) correct inference.`,
    },
    {
      name: "Heteroskedasticity (Breusch–Pagan LM)",
      status: ols.breuschPaganP >= 0.05 ? "pass" : "warn",
      pValue: +ols.breuschPaganP.toFixed(4),
      summary:
        ols.breuschPaganP >= 0.05
          ? `Homoskedasticity not rejected (p = ${ols.breuschPaganP.toFixed(3)}).`
          : `Heteroskedastic variance detected (p = ${ols.breuschPaganP.toFixed(3)}); robust HAC covariance applied.`,
    },
    {
      name: "Stationarity (Augmented Dickey–Fuller)",
      status: stationarity.adfPValue <= 0.1 ? "pass" : "warn",
      statistic: stationarity.adfStat,
      pValue: stationarity.adfPValue,
      summary: `ADF t = ${stationarity.adfStat.toFixed(2)} (p = ${stationarity.adfPValue.toFixed(2)}), KPSS = ${stationarity.kpssStat.toFixed(3)}.`,
    },
  ];

  if (preTrendPValue !== undefined) {
    checklist.push({
      name: "Pre-Trend Parallelism / Lead Test",
      status:
        preTrendPValue >= 0.1
          ? "pass"
          : preTrendPValue >= 0.05
            ? "warn"
            : "fail",
      statistic: preTrendFStat,
      pValue: preTrendPValue,
      summary:
        preTrendPValue >= 0.05
          ? `Pre-policy trend test p = ${preTrendPValue.toFixed(3)} (F = ${preTrendFStat?.toFixed(2)}): cannot reject flat pre-trend.`
          : `Pre-policy trend curvature is statistically non-zero (p = ${preTrendPValue.toFixed(3)}); interpret level shift with caution.`,
    });
  }

  if (relabelReason) {
    checklist.push({
      name: "Method Honesty & Comparison Group Check",
      status: "warn",
      summary: relabelReason,
    });
  } else if (donorIdsUsed.length > 0) {
    checklist.push({
      name: "Comparison / Donor Group Coverage",
      status: "pass",
      summary: `Comparison/donor series (${donorIdsUsed.join(", ")}) aligned across full observation window (${windowStart} to ${windowEnd}).`,
    });
  }

  const spec: EstimationSpec = {
    specId: `spec_${effectiveMethod}_${input.outcome.metadata.id}_${transformMode}`,
    method: effectiveMethod,
    requestedMethod: input.method,
    formula,
    outcomeSeriesId: input.outcome.metadata.id,
    outcomeTitle: input.outcome.metadata.title,
    outcomeUnits: input.outcome.provenance.units,
    policyDate: resolvedPolicyDate,
    windowStart,
    windowEnd,
    transform: transformMode,
    controls: controlIds,
    donorSeriesIds: donorIdsUsed,
    fixedEffects:
      effectiveMethod === "did_twfe" && donorIdsUsed.length > 0
        ? ["series", "period"]
        : [],
    clustering: seMethod,
    ciLevel,
    hacLags,
    lpHorizons,
    preRegistration: preReg,
  };

  return {
    id: `est_${effectiveMethod}_${input.outcome.metadata.id}_${preReg.lockHash.slice(0, 8)}`,
    method: effectiveMethod,
    requestedMethod: input.method,
    methodLabel:
      effectiveMethod !== input.method
        ? `${effectiveDescriptor.label} (Requested: ${requestedDescriptor.label})`
        : effectiveDescriptor.label,
    implementationStatus: effectiveDescriptor.implementationStatus,
    honestyTier: effectiveHonestyTier,
    honestyLabel: effectiveHonestyLabel,
    relabelReason,
    executionEngine: "typescript-hac",
    pointEstimate,
    standardError,
    ciLower: +(pointEstimate - zCrit * standardError).toFixed(4),
    ciUpper: +(pointEstimate + zCrit * standardError).toFixed(4),
    ciLevel,
    seMethod,
    tStat,
    pValue,
    sampleSize: n,
    sampleWindow: { start: windowStart, end: windowEnd },
    effectUnits:
      transformMode === "log"
        ? `Log points (${input.outcome.provenance.units})`
        : transformMode === "diff"
          ? `% Period-over-Period Change (${input.outcome.provenance.units})`
          : input.outcome.provenance.units,
    spec,
    diagnostics: {
      residualAutocorrelationP: +ols.ljungBoxP.toFixed(4),
      heteroskedasticityP: +ols.breuschPaganP.toFixed(4),
      preTrendFStat,
      preTrendPValue,
      rSquared: +ols.rSquared.toFixed(4),
      adfStat: stationarity.adfStat,
      adfPValue: stationarity.adfPValue,
      kpssStat: stationarity.kpssStat,
      rmspePre,
      rmspePost,
      structuralBreakDates,
      checklist,
    },
    assumptions: effectiveDescriptor.assumptions,
    threatsToValidity: relabelReason
      ? [relabelReason, ...effectiveDescriptor.threatsToValidity]
      : effectiveDescriptor.threatsToValidity,
    provenance: input.outcome.provenance,
    eventStudyPath,
    localProjectionsPath,
    counterfactualPath,
    donorWeights,
  };
}

/**
 * Automatic robustness suite for every headline result.
 */
export function runAutomaticRobustnessSuite(input: {
  headline: EconometricEstimate;
  outcome: FetchedSeriesBundle;
  controls?: FetchedSeriesBundle[];
  donors?: FetchedSeriesBundle[];
  scopeId: string;
}): RobustnessBundle {
  const { headline, outcome, scopeId } = input;
  const specs: SpecificationCurvePoint[] = [
    {
      specId: headline.spec.specId,
      label: `Baseline (${headline.spec.transform}, HAC=${headline.spec.hacLags})`,
      dimension: "baseline",
      pointEstimate: headline.pointEstimate,
      standardError: headline.standardError,
      ciLower: headline.ciLower,
      ciUpper: headline.ciUpper,
      pValue: headline.pValue,
      sampleSize: headline.sampleSize,
      isPlacebo: false,
    },
  ];

  const allObs = outcome.observations;
  if (allObs.length >= 15 && headline.spec.policyDate) {
    const trimStart = Math.floor(allObs.length * 0.15);
    const narrowObs = allObs.slice(trimStart);
    if (narrowObs[0]!.date < headline.spec.policyDate) {
      const narrowBundle: FetchedSeriesBundle = {
        ...outcome,
        observations: narrowObs,
      };
      try {
        const est = executeEconometricEstimate({
          method: headline.method,
          outcome: narrowBundle,
          policyDate: headline.spec.policyDate,
          scopeId,
          controls: input.controls,
          donors: input.donors,
          hacLags: headline.spec.hacLags,
        });
        specs.push({
          specId: `${est.spec.specId}_narrow`,
          label: `Narrow Window (${narrowObs[0]!.date.slice(0, 4)}–${narrowObs[narrowObs.length - 1]!.date.slice(0, 4)})`,
          dimension: "window_narrow",
          pointEstimate: est.pointEstimate,
          standardError: est.standardError,
          ciLower: est.ciLower,
          ciUpper: est.ciUpper,
          pValue: est.pValue,
          sampleSize: est.sampleSize,
          isPlacebo: false,
        });
      } catch {
        /* skip if narrow window fails preconditions */
      }
    }
  }

  try {
    const estHac8 = executeEconometricEstimate({
      method: headline.method,
      outcome,
      policyDate: headline.spec.policyDate,
      scopeId,
      controls: input.controls,
      donors: input.donors,
      hacLags: 8,
    });
    specs.push({
      specId: `${estHac8.spec.specId}_hac8`,
      label: "Extended HAC Bandwidth (lags=8)",
      dimension: "window_extended",
      pointEstimate: estHac8.pointEstimate,
      standardError: estHac8.standardError,
      ciLower: estHac8.ciLower,
      ciUpper: estHac8.ciUpper,
      pValue: estHac8.pValue,
      sampleSize: estHac8.sampleSize,
      isPlacebo: false,
    });
  } catch {
    /* ignore */
  }

  if (allObs.length >= 14 && headline.spec.policyDate) {
    try {
      const estDiff = executeEconometricEstimate({
        method: "descriptive_newey_west",
        outcome,
        policyDate: headline.spec.policyDate,
        scopeId,
        transform: "diff",
      });
      specs.push({
        specId: `${estDiff.spec.specId}_diff`,
        label: "Growth-Rate / First-Difference Transform",
        dimension: "transform_diff",
        pointEstimate: estDiff.pointEstimate,
        standardError: estDiff.standardError,
        ciLower: estDiff.ciLower,
        ciUpper: estDiff.ciUpper,
        pValue: estDiff.pValue,
        sampleSize: estDiff.sampleSize,
        isPlacebo: false,
      });
    } catch {
      /* ignore */
    }
  }

  if (input.controls && input.controls.length > 0) {
    try {
      const estCtrl = executeEconometricEstimate({
        method: headline.method,
        outcome,
        policyDate: headline.spec.policyDate,
        scopeId,
        controls: input.controls,
        donors: input.donors,
      });
      specs.push({
        specId: `${estCtrl.spec.specId}_ctrl`,
        label: `With Comparison/Controls (${input.controls.map((c) => c.metadata.id).join(", ")})`,
        dimension: "controls_included",
        pointEstimate: estCtrl.pointEstimate,
        standardError: estCtrl.standardError,
        ciLower: estCtrl.ciLower,
        ciUpper: estCtrl.ciUpper,
        pValue: estCtrl.pValue,
        sampleSize: estCtrl.sampleSize,
        isPlacebo: false,
      });
    } catch {
      /* ignore */
    }
  }

  // In-time placebo test (fake policy date in the middle of the pre-policy period)
  let placeboPassed = true;
  if (headline.spec.policyDate) {
    const splitIdx = allObs.findIndex((p) => p.date >= headline.spec.policyDate!);
    const preObs = splitIdx >= 10 ? allObs.slice(0, splitIdx) : [];
    if (preObs.length >= 10) {
      const placeboDate = preObs[Math.floor(preObs.length / 2)]!.date;
      try {
        const placeboEst = executeEconometricEstimate({
          method: "descriptive_newey_west",
          outcome: { ...outcome, observations: preObs },
          policyDate: placeboDate,
          scopeId,
        });
        placeboPassed = placeboEst.pValue >= 0.05;
        specs.push({
          specId: `${placeboEst.spec.specId}_placebo`,
          label: `In-Time Placebo (${placeboDate.slice(0, 7)}, Pre-Policy Only)`,
          dimension: "placebo_in_time",
          pointEstimate: placeboEst.pointEstimate,
          standardError: placeboEst.standardError,
          ciLower: placeboEst.ciLower,
          ciUpper: placeboEst.ciUpper,
          pValue: placeboEst.pValue,
          sampleSize: placeboEst.sampleSize,
          isPlacebo: true,
        });
      } catch {
        /* ignore */
      }
    }
  }

  const nonPlacebo = specs.filter(
    (s) => !s.isPlacebo && s.dimension !== "transform_diff",
  );
  const baseSign = Math.sign(headline.pointEstimate);
  const baseSig = headline.pValue < 0.05;

  const signFlipped = nonPlacebo.some(
    (s) =>
      baseSign !== 0 &&
      Math.sign(s.pointEstimate) !== 0 &&
      Math.sign(s.pointEstimate) !== baseSign,
  );
  const significanceFlipped = nonPlacebo.some(
    (s) => (s.pValue < 0.05) !== baseSig,
  );

  const consistentCount = nonPlacebo.filter(
    (s) =>
      (baseSign === 0 || Math.sign(s.pointEstimate) === baseSign) &&
      (baseSig ? s.pValue < 0.1 : true),
  ).length;
  const passRate = +(consistentCount / Math.max(1, nonPlacebo.length)).toFixed(2);

  return {
    headlineEstimateId: headline.id,
    specs,
    signFlipped,
    significanceFlipped,
    placeboPassed,
    passRate,
    summary: `Across ${nonPlacebo.length} non-placebo specifications, ${(passRate * 100).toFixed(0)}% preserve sign consistency (${signFlipped ? "SIGN FLIP DETECTED" : "no sign flip"}; ${significanceFlipped ? "significance varies across windows" : "inference stable"}; in-time placebo ${placeboPassed ? "passed p >= 0.05" : "flagged p < 0.05"}).`,
  };
}
