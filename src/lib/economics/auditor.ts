import type { FetchedSeriesBundle } from "@/lib/data/types";
import type { ExtractedLiteratureEstimate } from "@/lib/mcp/openalex";
import type {
  EconometricEstimate,
  NumericAuditEntry,
  NumericAuditReport,
  RobustnessBundle,
} from "./schemas";

export type AllowedNumericReference = {
  id: string;
  label: string;
  value: number;
};

/**
 * Collects every legitimate numeric value produced by fetched live observations,
 * computed econometric estimates, robustness specifications, and quote-backed literature.
 */
export function buildAllowedNumericRegistry(input: {
  bundles?: FetchedSeriesBundle[];
  estimates?: EconometricEstimate[];
  robustness?: RobustnessBundle[];
  literature?: ExtractedLiteratureEstimate[];
}): AllowedNumericReference[] {
  const refs: AllowedNumericReference[] = [];

  for (const bundle of input.bundles ?? []) {
    const id = bundle.metadata.id;
    const pts = bundle.observations;
    if (pts.length === 0) continue;
    const first = pts[0]!;
    const last = pts[pts.length - 1]!;
    refs.push(
      { id: `${id}:latest`, label: `${id} latest (${last.date})`, value: last.value },
      { id: `${id}:earliest`, label: `${id} earliest (${first.date})`, value: first.value },
      { id: `${id}:count`, label: `${id} sample size N`, value: pts.length },
    );
    if (first.value !== 0) {
      const pctChange = ((last.value - first.value) / Math.abs(first.value)) * 100;
      refs.push({
        id: `${id}:window_pct_change`,
        label: `${id} window % change`,
        value: pctChange,
      });
    }
    // Include recent observations so exact period citations match
    for (const pt of pts.slice(-24)) {
      refs.push({
        id: `${id}:${pt.date}`,
        label: `${id} on ${pt.date}`,
        value: pt.value,
      });
    }
  }

  for (const est of input.estimates ?? []) {
    refs.push(
      { id: `${est.id}:beta`, label: `${est.methodLabel} point estimate`, value: est.pointEstimate },
      { id: `${est.id}:se`, label: `${est.methodLabel} standard error`, value: est.standardError },
      { id: `${est.id}:ci_low`, label: `${est.methodLabel} CI lower`, value: est.ciLower },
      { id: `${est.id}:ci_high`, label: `${est.methodLabel} CI upper`, value: est.ciUpper },
      { id: `${est.id}:pval`, label: `${est.methodLabel} p-value`, value: est.pValue },
      { id: `${est.id}:tstat`, label: `${est.methodLabel} t-stat`, value: est.tStat },
      { id: `${est.id}:n`, label: `${est.methodLabel} N`, value: est.sampleSize },
      { id: `${est.id}:ci_level`, label: "CI percentage", value: est.ciLevel * 100 },
    );
    if (est.diagnostics.rSquared !== undefined) {
      refs.push({
        id: `${est.id}:r2`,
        label: "R-squared",
        value: est.diagnostics.rSquared,
      });
    }
    if (est.diagnostics.preTrendPValue !== undefined) {
      refs.push({
        id: `${est.id}:pretrend_p`,
        label: "Pre-trend p-value",
        value: est.diagnostics.preTrendPValue,
      });
    }
    if (est.diagnostics.adfStat !== undefined) {
      refs.push({
        id: `${est.id}:adf`,
        label: "ADF statistic",
        value: est.diagnostics.adfStat,
      });
    }
    for (const lp of est.localProjectionsPath ?? []) {
      refs.push({
        id: `${est.id}:lp_h${lp.horizon}`,
        label: `Local projection h=${lp.horizon}`,
        value: lp.irfEstimate,
      });
    }
    for (const ev of est.eventStudyPath ?? []) {
      refs.push({
        id: `${est.id}:es_t${ev.relPeriod}`,
        label: `Event study k=${ev.relPeriod}`,
        value: ev.estimate,
      });
    }
  }

  for (const rob of input.robustness ?? []) {
    refs.push({
      id: `${rob.headlineEstimateId}:pass_rate_pct`,
      label: "Robustness pass rate %",
      value: rob.passRate * 100,
    });
    for (const sp of rob.specs) {
      refs.push(
        { id: `${sp.specId}:beta`, label: sp.label, value: sp.pointEstimate },
        { id: `${sp.specId}:pval`, label: `${sp.label} p-value`, value: sp.pValue },
      );
    }
  }

  for (const lit of input.literature ?? []) {
    if (lit.pointEstimate !== undefined && lit.quoteSpan) {
      refs.push({
        id: `lit:${lit.workId}`,
        label: lit.honestyLabel,
        value: lit.pointEstimate,
      });
    }
  }

  return refs;
}

function isStructuralOrDateNumber(
  rawToken: string,
  fullText: string,
  matchIndex: number,
): boolean {
  const num = Number.parseFloat(rawToken.replace(/,/g, "").replace(/%$/, ""));
  if (!Number.isFinite(num)) return true;

  // Calendar years (1900..2100) without % sign
  if (!rawToken.endsWith("%") && Number.isInteger(num) && num >= 1900 && num <= 2100) {
    return true;
  }

  // Small structural integers (e.g., 1..12 stages, steps, lags, quarters Q+1..Q+8, 95% CI, 5% alpha)
  if (num === 95 || num === 90 || num === 99 || num === 5 || num === 0) {
    return true;
  }
  if (!rawToken.includes(".") && !rawToken.endsWith("%") && Math.abs(num) <= 12) {
    return true;
  }

  // Preceded by date hyphen, section heading, HS code, or horizon marker
  const prefix = fullText.slice(Math.max(0, matchIndex - 14), matchIndex);
  if (
    /(?:HS\s*|Section\s*|Table\s*|Figure\s*|Step\s*|Stage\s*|Q\+|h=|t[+-]|k=|\d{4}-|#|\bv)\s*$/i.test(
      prefix,
    )
  ) {
    return true;
  }

  return false;
}

/**
 * Deterministic Data Auditor (Code, NOT an LLM):
 * Extracts every numeric figure from generated prose, matches it against
 * fetched observations, computed econometric estimates, or quote-backed literature
 * within rounding tolerance, and strips/flags any untraced numbers.
 */
export function auditGeneratedProseNumbers(
  text: string,
  registry: AllowedNumericReference[],
  options?: { stripUntraced?: boolean; toleranceRel?: number; toleranceAbs?: number },
): NumericAuditReport {
  const tolRel = options?.toleranceRel ?? 0.03; // 3% relative rounding tolerance
  const tolAbs = options?.toleranceAbs ?? 0.15; // 0.15 absolute rounding tolerance
  const entries: NumericAuditEntry[] = [];
  const untracedNumbers: NumericAuditEntry[] = [];

  // Match numbers outside square-bracket citations and URLs
  const tokenRegex = /(?<![A-Za-z0-9_/-])([+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?%?|[+-]?\d+\.\d+%?|[+-]?\d+%)(?![A-Za-z0-9_/-])/g;

  let sanitizedText = text;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(text)) !== null) {
    const rawToken = match[1]!;
    const idx = match.index;

    // Ignore numbers inside URLs or markdown link targets
    const before = text.slice(Math.max(0, idx - 40), idx);
    if (/https?:\/\/[^\s)]*$/i.test(before) || /\[[^\]]*$/i.test(before)) {
      continue;
    }

    if (isStructuralOrDateNumber(rawToken, text, idx)) {
      continue;
    }

    const numericValue = Number.parseFloat(
      rawToken.replace(/,/g, "").replace(/%$/, ""),
    );
    if (!Number.isFinite(numericValue)) continue;

    let bestRef: AllowedNumericReference | null = null;
    for (const ref of registry) {
      const diff = Math.abs(numericValue - ref.value);
      const rel = Math.abs(ref.value) > 1e-6 ? diff / Math.abs(ref.value) : diff;
      if (diff <= tolAbs || rel <= tolRel) {
        bestRef = ref;
        break;
      }
    }

    const entry: NumericAuditEntry = {
      rawToken,
      numericValue,
      matchedReferenceId: bestRef?.id ?? null,
      matchedSourceLabel: bestRef?.label ?? null,
      passed: Boolean(bestRef),
    };
    entries.push(entry);
    if (!bestRef) {
      untracedNumbers.push(entry);
    }
  }

  if (options?.stripUntraced && untracedNumbers.length > 0) {
    for (const bad of untracedNumbers) {
      sanitizedText = sanitizedText.replace(
        bad.rawToken,
        `[unverified number removed by Data Auditor]`,
      );
    }
  }

  return {
    passed: untracedNumbers.length === 0,
    totalNumbersChecked: entries.length,
    matchedCount: entries.length - untracedNumbers.length,
    untracedNumbers,
    entries,
    sanitizedText,
  };
}
