import type { ObservationPoint } from "@/lib/data/types";
import type { EconometricEstimate, EconometricMethodId } from "./schemas";

export type PythonEstimateResponse = {
  ok: boolean;
  error?: string;
  pointEstimate?: number;
  standardError?: number;
  ciLower?: number;
  ciUpper?: number;
  pValue?: number;
  sampleSize?: number;
  rSquared?: number;
  diagnostics?: {
    ljungBoxP?: number;
    breuschPaganP?: number;
  };
};

/**
 * Optional live bridge to the Python econometrics service (`api/econometrics/estimate.py`)
 * when `PYTHON_ECONOMETRICS_URL` is configured.
 */
export async function callPythonEconometricsService(input: {
  specId: string;
  method: EconometricMethodId;
  outcomeSeriesId: string;
  outcomeTitle: string;
  outcomeUnits: string;
  policyDate: string | null;
  ciLevel: number;
  hacLags: number;
  lpHorizons: number;
  observations: ObservationPoint[];
}): Promise<PythonEstimateResponse | null> {
  const url = process.env.PYTHON_ECONOMETRICS_URL?.trim();
  if (!url) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as PythonEstimateResponse;
    return data.ok ? data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Enriches an existing TypeScript EconometricEstimate with results from the Python
 * statsmodels service when `PYTHON_ECONOMETRICS_URL` is configured and reachable.
 */
export async function maybeEnrichWithPythonService(
  estimate: EconometricEstimate,
  observations: ObservationPoint[],
): Promise<EconometricEstimate> {
  const py = await callPythonEconometricsService({
    specId: estimate.spec.specId,
    method: estimate.method,
    outcomeSeriesId: estimate.spec.outcomeSeriesId,
    outcomeTitle: estimate.spec.outcomeTitle,
    outcomeUnits: estimate.spec.outcomeUnits,
    policyDate: estimate.spec.policyDate,
    ciLevel: estimate.ciLevel,
    hacLags: estimate.spec.hacLags,
    lpHorizons: estimate.spec.lpHorizons,
    observations,
  });

  if (
    !py ||
    typeof py.pointEstimate !== "number" ||
    typeof py.standardError !== "number"
  ) {
    return estimate;
  }

  return {
    ...estimate,
    executionEngine: "python-statsmodels",
    pointEstimate: py.pointEstimate,
    standardError: py.standardError,
    ciLower: py.ciLower ?? estimate.ciLower,
    ciUpper: py.ciUpper ?? estimate.ciUpper,
    pValue: py.pValue ?? estimate.pValue,
    diagnostics: {
      ...estimate.diagnostics,
      rSquared: py.rSquared ?? estimate.diagnostics.rSquared,
      residualAutocorrelationP:
        py.diagnostics?.ljungBoxP ??
        estimate.diagnostics.residualAutocorrelationP,
      heteroskedasticityP:
        py.diagnostics?.breuschPaganP ??
        estimate.diagnostics.heteroskedasticityP,
    },
  };
}
