import type { FetchedSeriesBundle } from "@/lib/data/types";
import type { ExtractedLiteratureEstimate } from "@/lib/mcp/openalex";
import type { CompiledPolicyReport } from "@/lib/reports/report-types";
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
  kind: "observation" | "series_summary" | "estimate" | "robustness" | "literature";
  seriesId?: string;
  date?: string;
  estimateId?: string;
};

/**
 * Collects every legitimate numeric value produced by fetched live observations,
 * computed econometric estimates, robustness specifications, and quote-backed literature,
 * tagged with its exact seriesId, date, or estimateId so numbers in prose must match
 * the specific object they cite.
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
      {
        id: `${id}:latest`,
        label: `${id} latest (${last.date})`,
        value: last.value,
        kind: "series_summary",
        seriesId: id,
        date: last.date,
      },
      {
        id: `${id}:earliest`,
        label: `${id} earliest (${first.date})`,
        value: first.value,
        kind: "series_summary",
        seriesId: id,
        date: first.date,
      },
      {
        id: `${id}:count`,
        label: `${id} sample size N`,
        value: pts.length,
        kind: "series_summary",
        seriesId: id,
      },
    );
    if (first.value !== 0) {
      const pctChange = ((last.value - first.value) / Math.abs(first.value)) * 100;
      refs.push({
        id: `${id}:window_pct_change`,
        label: `${id} window % change`,
        value: pctChange,
        kind: "series_summary",
        seriesId: id,
      });
    }
    for (const pt of pts) {
      refs.push({
        id: `${id}:${pt.date}`,
        label: `${id} on ${pt.date}`,
        value: pt.value,
        kind: "observation",
        seriesId: id,
        date: pt.date,
      });
    }
  }

  for (const est of input.estimates ?? []) {
    const sid = est.spec.outcomeSeriesId;
    refs.push(
      {
        id: `${est.id}:beta`,
        label: `${est.methodLabel} point estimate`,
        value: est.pointEstimate,
        kind: "estimate",
        seriesId: sid,
        estimateId: est.id,
      },
      {
        id: `${est.id}:se`,
        label: `${est.methodLabel} standard error`,
        value: est.standardError,
        kind: "estimate",
        seriesId: sid,
        estimateId: est.id,
      },
      {
        id: `${est.id}:ci_low`,
        label: `${est.methodLabel} CI lower`,
        value: est.ciLower,
        kind: "estimate",
        seriesId: sid,
        estimateId: est.id,
      },
      {
        id: `${est.id}:ci_high`,
        label: `${est.methodLabel} CI upper`,
        value: est.ciUpper,
        kind: "estimate",
        seriesId: sid,
        estimateId: est.id,
      },
      {
        id: `${est.id}:pval`,
        label: `${est.methodLabel} p-value`,
        value: est.pValue,
        kind: "estimate",
        seriesId: sid,
        estimateId: est.id,
      },
      {
        id: `${est.id}:tstat`,
        label: `${est.methodLabel} t-stat`,
        value: est.tStat,
        kind: "estimate",
        seriesId: sid,
        estimateId: est.id,
      },
      {
        id: `${est.id}:n`,
        label: `${est.methodLabel} N`,
        value: est.sampleSize,
        kind: "estimate",
        seriesId: sid,
        estimateId: est.id,
      },
      {
        id: `${est.id}:ci_level`,
        label: "CI percentage",
        value: est.ciLevel * 100,
        kind: "estimate",
        seriesId: sid,
        estimateId: est.id,
      },
    );
    if (est.diagnostics.rSquared !== undefined) {
      refs.push({
        id: `${est.id}:r2`,
        label: "R-squared",
        value: est.diagnostics.rSquared,
        kind: "estimate",
        seriesId: sid,
        estimateId: est.id,
      });
    }
    if (est.diagnostics.preTrendPValue !== undefined) {
      refs.push({
        id: `${est.id}:pretrend_p`,
        label: "Pre-trend p-value",
        value: est.diagnostics.preTrendPValue,
        kind: "estimate",
        seriesId: sid,
        estimateId: est.id,
      });
    }
    if (est.diagnostics.adfStat !== undefined) {
      refs.push({
        id: `${est.id}:adf`,
        label: "ADF statistic",
        value: est.diagnostics.adfStat,
        kind: "estimate",
        seriesId: sid,
        estimateId: est.id,
      });
    }
    for (const lp of est.localProjectionsPath ?? []) {
      refs.push({
        id: `${est.id}:lp_h${lp.horizon}`,
        label: `Local projection h=${lp.horizon}`,
        value: lp.irfEstimate,
        kind: "estimate",
        seriesId: sid,
        estimateId: est.id,
      });
    }
    for (const ev of est.eventStudyPath ?? []) {
      refs.push({
        id: `${est.id}:es_t${ev.relPeriod}`,
        label: `Event study k=${ev.relPeriod}`,
        value: ev.estimate,
        kind: "estimate",
        seriesId: sid,
        estimateId: est.id,
      });
    }
  }

  for (const rob of input.robustness ?? []) {
    refs.push({
      id: `${rob.headlineEstimateId}:pass_rate_pct`,
      label: "Robustness pass rate %",
      value: rob.passRate * 100,
      kind: "robustness",
      estimateId: rob.headlineEstimateId,
    });
    for (const sp of rob.specs) {
      refs.push(
        {
          id: `${sp.specId}:beta`,
          label: sp.label,
          value: sp.pointEstimate,
          kind: "robustness",
          estimateId: rob.headlineEstimateId,
        },
        {
          id: `${sp.specId}:pval`,
          label: `${sp.label} p-value`,
          value: sp.pValue,
          kind: "robustness",
          estimateId: rob.headlineEstimateId,
        },
      );
    }
  }

  for (const lit of input.literature ?? []) {
    if (lit.pointEstimate !== undefined && lit.quoteSpan) {
      refs.push({
        id: `lit:${lit.workId}`,
        label: lit.honestyLabel,
        value: lit.pointEstimate,
        kind: "literature",
      });
    }
  }

  return refs;
}

/**
 * Rounding-aware numeric matcher:
 * Checks whether `numericValue` (parsed from `rawToken`) is an exact decimal rounding
 * of `refValue` at the precision printed in `rawToken` (half-unit in the last decimal place).
 */
export function isRoundingAwareMatch(
  rawToken: string,
  numericValue: number,
  refValue: number,
): boolean {
  if (!Number.isFinite(numericValue) || !Number.isFinite(refValue)) return false;
  if (Math.abs(numericValue - refValue) < 1e-9) return true;

  const cleaned = rawToken.replace(/[,%+-]/g, "").trim();
  const dotIdx = cleaned.indexOf(".");
  const decimals = dotIdx === -1 ? 0 : cleaned.length - dotIdx - 1;

  // Half a unit in the last printed decimal place (plus tiny IEEE-754 epsilon)
  const halfUlps = 0.5 * Math.pow(10, -decimals) + 1e-7;
  if (Math.abs(numericValue - refValue) <= halfUlps) {
    return true;
  }

  // Also check explicit toFixed(decimals) equality
  if (Number(refValue.toFixed(decimals)) === numericValue) {
    return true;
  }

  return false;
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

  // Standard statistical confidence/significance levels (95%, 90%, 99%, 5%, 0.05, 0.01, 0.10, 0)
  if (
    num === 95 ||
    num === 90 ||
    num === 99 ||
    num === 5 ||
    num === 0 ||
    rawToken === "0.05" ||
    rawToken === "0.01" ||
    rawToken === "0.10" ||
    rawToken === "0.001"
  ) {
    return true;
  }
  if (!rawToken.includes(".") && !rawToken.endsWith("%") && Math.abs(num) <= 10) {
    return true;
  }

  const prefix = fullText.slice(Math.max(0, matchIndex - 16), matchIndex);
  if (
    /(?:HS\s*|Section\s*|Table\s*|Figure\s*|Step\s*|Stage\s*|Q\+|h=|t[+-]|k=|lags?=|\d{4}-|#|\bv)\s*$/i.test(
      prefix,
    )
  ) {
    return true;
  }

  return false;
}

/**
 * Extracts the surrounding sentence/clause context around a match index.
 */
function getSentenceContext(text: string, index: number): string {
  const start = Math.max(0, text.lastIndexOf(".", index - 1) + 1, index - 180);
  const nextDot = text.indexOf(".", index);
  const end =
    nextDot === -1 ? Math.min(text.length, index + 180) : Math.min(nextDot + 1, index + 180);
  return text.slice(start, end);
}

/**
 * Deterministic Data Auditor (Code, NOT an LLM):
 * Extracts every numeric figure from generated prose and verifies that:
 * 1. It matches a reference value using exact rounding-aware precision (`isRoundingAwareMatch`).
 * 2. If the reference is a specific date's raw observation (`kind === "observation"`), the sentence
 *    must explicitly cite that observation's date (`YYYY-MM-DD` or `YYYY-MM`) AND series ID (or `[ev_fred]`).
 *    Otherwise, numbers in prose may only match estimate statistics, robustness statistics,
 *    series summary endpoints (`latest`/`earliest`/`count`/`window_pct_change`), or quote-backed literature.
 * 3. If the sentence explicitly names a series ID, the matched reference must belong to that series (or an estimate on that series).
 */
export function auditGeneratedProseNumbers(
  text: string,
  registry: AllowedNumericReference[],
  options?: { stripUntraced?: boolean },
): NumericAuditReport {
  const entries: NumericAuditEntry[] = [];
  const untracedNumbers: NumericAuditEntry[] = [];

  const knownSeriesIds = [
    ...new Set(
      registry.map((r) => r.seriesId).filter((s): s is string => Boolean(s)),
    ),
  ];

  const tokenRegex =
    /(?<![A-Za-z0-9_/-])([+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?%?|[+-]?\d+\.\d+%?|[+-]?\d+%)(?![A-Za-z0-9_/-])/g;

  let sanitizedText = text;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(text)) !== null) {
    const rawToken = match[1]!;
    const idx = match.index;

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

    const sentence = getSentenceContext(text, idx);
    const mentionedSeriesIds = knownSeriesIds.filter((sid) =>
      sentence.toUpperCase().includes(sid.toUpperCase()),
    );
    const mentionedDates = [
      ...sentence.matchAll(/\b(19\d{2}|20\d{2})-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?\b/g),
    ].map((m) => m[0]!);

    let bestRef: AllowedNumericReference | null = null;
    for (const ref of registry) {
      if (!isRoundingAwareMatch(rawToken, numericValue, ref.value)) {
        continue;
      }

      // If the sentence names specific series ID(s) and this ref belongs to a different series, skip it
      if (
        mentionedSeriesIds.length > 0 &&
        ref.seriesId &&
        !mentionedSeriesIds.some(
          (sid) => sid.toUpperCase() === ref.seriesId!.toUpperCase(),
        )
      ) {
        continue;
      }

      // Raw interior observations may ONLY be matched if the sentence explicitly cites that date (YYYY-MM or YYYY-MM-DD)
      if (ref.kind === "observation") {
        if (!ref.date || mentionedDates.length === 0) {
          continue;
        }
        const dateCited = mentionedDates.some(
          (d) => ref.date!.startsWith(d) || d.startsWith(ref.date!.slice(0, 7)),
        );
        if (!dateCited) continue;
      }

      bestRef = ref;
      break;
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

/**
 * Runs every narrative field of a CompiledPolicyReport through the deterministic Data Auditor
 * so compiled AI reports strip or flag any untraced numbers before display.
 */
export function auditCompiledPolicyReport(
  report: CompiledPolicyReport,
  input: {
    fredSeries: Array<{
      key?: string;
      seriesId: string;
      title: string;
      units: string;
      url?: string;
      resultHash?: string;
      nodeTitle?: string;
      points: Array<{ date: string; value: number }>;
    }>;
    estimates?: EconometricEstimate[];
    robustness?: RobustnessBundle[];
  },
): CompiledPolicyReport {
  const bundles: FetchedSeriesBundle[] = input.fredSeries
    .filter((s) => s.points.length > 0)
    .map((s) => ({
      metadata: {
        provider: "fred" as const,
        id: s.seriesId,
        title: s.title,
        units: s.units,
        frequency: "Reported",
        frequencyShort: "unknown" as const,
        seasonalAdjustment: "Reported",
        observationStart: s.points[0]!.date,
        observationEnd: s.points[s.points.length - 1]!.date,
        lastUpdated: s.points[s.points.length - 1]!.date,
        discontinued: false,
        copyrightedThirdParty: false,
        licenseAttribution: "FRED",
        sourceUrl: s.url || `https://fred.stlouisfed.org/series/${s.seriesId}`,
      },
      observations: s.points,
      provenance: {
        source: "fred" as const,
        seriesId: s.seriesId,
        title: s.title,
        units: s.units || "Units",
        transform: "lin",
        seasonalAdjustment: "Reported",
        frequency: "Reported",
        observationWindow: {
          start: s.points[0]!.date,
          end: s.points[s.points.length - 1]!.date,
        },
        lastUpdated: s.points[s.points.length - 1]!.date,
        retrievedAt: new Date().toISOString(),
        url: s.url || `https://fred.stlouisfed.org/series/${s.seriesId}`,
        licenseAttribution: "FRED",
        copyrightedThirdParty: false,
        payloadSha256: s.resultHash || "00000000000000000000000000000000",
      },
      snapshot: {
        id: `snap_${s.seriesId}`,
        provider: "fred" as const,
        seriesId: s.seriesId,
        requestUrl: s.url || "",
        retrievedAt: new Date().toISOString(),
        sha256: s.resultHash || "00000000000000000000000000000000",
        byteLength: s.points.length * 16,
        rawJson: "[]",
      },
    }));

  const registry = buildAllowedNumericRegistry({
    bundles,
    estimates: input.estimates,
    robustness: input.robustness,
  });

  const auditField = (text: string) =>
    auditGeneratedProseNumbers(text, registry, { stripUntraced: true })
      .sanitizedText;

  return {
    ...report,
    executiveSummary: auditField(report.executiveSummary),
    spineNarrative: auditField(report.spineNarrative),
    methodologyAndTrace: auditField(report.methodologyAndTrace),
    risksAndCounterfactuals: auditField(report.risksAndCounterfactuals),
    keyFindings: report.keyFindings.map((kf) => ({
      ...kf,
      detail: auditField(kf.detail),
    })),
  };
}
