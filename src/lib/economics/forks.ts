import type { FetchedSeriesBundle } from "@/lib/data/types";
import { executeEconometricEstimate } from "./estimators";
import type { EconometricEstimate, EconometricMethodId } from "./schemas";

export type SpecificationForkDefinition = {
  id: string;
  label: string;
  reason: string;
  parameterChanged: "method" | "window" | "transform" | "policy_date" | "series";
  method: EconometricMethodId;
  transform: "lin" | "log" | "diff";
  policyDate: string | null;
  windowTrimPct?: number;
};

export type ForkComparisonResult = {
  fork: SpecificationForkDefinition;
  baselineEstimate: EconometricEstimate;
  forkEstimate: EconometricEstimate;
  pointDelta: number;
  signChanged: boolean;
  significanceChanged: boolean;
  conclusionSummary: string;
};

/**
 * Default Skeptic "What would change my mind" falsification forks that the user can
 * execute and compare side-by-side against the baseline pre-registered specification.
 */
export function buildDefaultSkepticForks(
  baseline: EconometricEstimate,
): SpecificationForkDefinition[] {
  return [
    {
      id: "fork_jorda_lp",
      label: "Switch Estimator → Jordà Local Projections (h=4)",
      reason:
        "Tests whether horizon-specific impulse responses with HAC SEs confirm the event-study shift.",
      parameterChanged: "method",
      method: "local_projections_jorda",
      transform: (baseline.spec.transform as "lin" | "log" | "diff") || "lin",
      policyDate: baseline.spec.policyDate,
    },
    {
      id: "fork_diff_transform",
      label: "Switch Transform → Growth-Rate / First Differences",
      reason:
        "Eliminates unit-root nonstationarity and secular drift by estimating in period-over-period % changes.",
      parameterChanged: "transform",
      method: "descriptive_newey_west",
      transform: "diff",
      policyDate: baseline.spec.policyDate,
    },
    {
      id: "fork_trimmed_window",
      label: "Narrow Window → Drop Earliest 25% Pre-Period",
      reason:
        "Tests whether early structural regime observations drive the pre-policy counterfactual slope.",
      parameterChanged: "window",
      method: baseline.method,
      transform: (baseline.spec.transform as "lin" | "log" | "diff") || "lin",
      policyDate: baseline.spec.policyDate,
      windowTrimPct: 0.25,
    },
    {
      id: "fork_chow_break",
      label: "Structural Break Check → Bai–Perron Unknown Break",
      reason:
        "Tests whether the most statistically significant break date coincides with the statutory policy date.",
      parameterChanged: "method",
      method: "bai_perron_break",
      transform: (baseline.spec.transform as "lin" | "log" | "diff") || "lin",
      policyDate: baseline.spec.policyDate,
    },
  ];
}

/**
 * Executes a specification fork against the live outcome bundle, linking its
 * pre-registration hash to the baseline's `lockHash` (`forkParentHash`).
 */
export function evaluateSpecificationFork(input: {
  baseline: EconometricEstimate;
  outcome: FetchedSeriesBundle;
  fork: SpecificationForkDefinition;
  scopeId: string;
}): ForkComparisonResult {
  const { baseline, outcome, fork, scopeId } = input;
  const trim = fork.windowTrimPct ?? 0;
  const startIdx =
    trim > 0 ? Math.min(outcome.observations.length - 10, Math.floor(outcome.observations.length * trim)) : 0;

  const forkedBundle: FetchedSeriesBundle = {
    ...outcome,
    observations: outcome.observations.slice(Math.max(0, startIdx)),
  };

  const forkEstimate = executeEconometricEstimate({
    method: fork.method,
    outcome: forkedBundle,
    policyDate: fork.policyDate,
    scopeId,
    transform: fork.transform,
    forkParentHash: baseline.spec.preRegistration.lockHash,
    forkReason: fork.reason,
  });

  const pointDelta = +(forkEstimate.pointEstimate - baseline.pointEstimate).toFixed(4);
  const signChanged =
    Math.sign(forkEstimate.pointEstimate) !== 0 &&
    Math.sign(baseline.pointEstimate) !== 0 &&
    Math.sign(forkEstimate.pointEstimate) !== Math.sign(baseline.pointEstimate);
  const significanceChanged =
    (forkEstimate.pValue < 0.05) !== (baseline.pValue < 0.05);

  const conclusionSummary = signChanged
    ? `SIGN FLIP: Fork changes estimate from ${baseline.pointEstimate} to ${forkEstimate.pointEstimate} (p = ${forkEstimate.pValue}).`
    : significanceChanged
      ? `Inference shift: Fork estimate is ${forkEstimate.pointEstimate} (95% CI [${forkEstimate.ciLower}, ${forkEstimate.ciUpper}], p = ${forkEstimate.pValue}) vs. baseline p = ${baseline.pValue}.`
      : `Robust: Fork preserves sign and significance (β = ${forkEstimate.pointEstimate}, 95% CI [${forkEstimate.ciLower}, ${forkEstimate.ciUpper}], p = ${forkEstimate.pValue}).`;

  return {
    fork,
    baselineEstimate: baseline,
    forkEstimate,
    pointDelta,
    signChanged,
    significanceChanged,
    conclusionSummary,
  };
}
