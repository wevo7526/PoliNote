import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  auditCompiledPolicyReport,
  auditGeneratedProseNumbers,
  buildAllowedNumericRegistry,
  isRoundingAwareMatch,
} from "../src/lib/economics/auditor";
import { buildRunEconomicModel } from "../src/lib/economics/engine";
import {
  createPreRegistrationLock,
  executeEconometricEstimate,
  runAutomaticRobustnessSuite,
} from "../src/lib/economics/estimators";
import {
  buildDefaultSkepticForks,
  evaluateSpecificationFork,
} from "../src/lib/economics/forks";
import { solveSyntheticControlWeights } from "../src/lib/economics/math";
import { convertFrequency } from "../src/lib/data/harmonize";
import { deriveObservationWindow } from "../src/lib/data/selector";
import type { FetchedSeriesBundle, ObservationPoint } from "../src/lib/data/types";
import {
  evaluateBenchmarkQuestion,
  POLICY_BENCHMARK_SUITE,
  summarizeBenchmarkSuite,
  type PolicyBenchmarkItem,
} from "../src/lib/evaluation/benchmarks";
import {
  extractEstimateFromAbstract,
  reconstructAbstract,
} from "../src/lib/mcp/openalex";
import {
  buildCsvBundleContent,
  buildJupyterNotebookObject,
  PINNED_PYTHON_PACKAGES,
} from "../src/lib/reports/reproducibility";
import {
  evaluateWorkspaceSession,
  SessionConfigError,
  SessionForbiddenError,
  signSessionUserId,
} from "../src/lib/session";
import { evaluateClaimStatusFromEstimate } from "../src/schemas/digression";

/**
 * Test-only fixture generator (lives strictly in tests/, never in app code).
 */
function makeKnownStepFixture(options?: {
  seriesId?: string;
  title?: string;
  policyYear?: number;
  jump?: number;
}): FetchedSeriesBundle {
  const seriesId = options?.seriesId ?? "TEST_PNFI";
  const title =
    options?.title ?? "Fixture Real Private Nonresidential Fixed Investment";
  const policyYear = options?.policyYear ?? 2018;
  const jump = options?.jump ?? 12.0;
  const startYear = policyYear - 6;
  const endYear = policyYear + 6;

  const observations: ObservationPoint[] = [];
  let idx = 0;
  for (let year = startYear; year <= endYear; year += 1) {
    for (const month of ["01", "04", "07", "10"]) {
      const date = `${year}-${month}-01`;
      const isPost = year >= policyYear;
      const noise = idx % 2 === 0 ? 0.15 : -0.15;
      const value = +(100 + 0.5 * idx + (isPost ? jump : 0) + noise).toFixed(4);
      observations.push({ date, value });
      idx += 1;
    }
  }

  const firstDate = observations[0]!.date;
  const lastDate = observations[observations.length - 1]!.date;

  return {
    metadata: {
      provider: "fred",
      id: seriesId,
      title,
      units: "Billions of Chained Dollars",
      frequency: "Quarterly",
      frequencyShort: "q",
      seasonalAdjustment: "Seasonally Adjusted Annual Rate",
      observationStart: firstDate,
      observationEnd: lastDate,
      lastUpdated: "2025-01-15",
      discontinued: false,
      copyrightedThirdParty: false,
      licenseAttribution: "Test Fixture Only",
      sourceUrl: `https://fred.stlouisfed.org/series/${seriesId}`,
    },
    observations,
    provenance: {
      source: "fred",
      seriesId,
      title,
      units: "Billions of Chained Dollars",
      transform: "lin — Levels",
      seasonalAdjustment: "Seasonally Adjusted Annual Rate",
      frequency: "Quarterly",
      observationWindow: { start: firstDate, end: lastDate },
      vintageDate: "2025-01-15",
      lastUpdated: "2025-01-15",
      retrievedAt: "2025-01-15T00:00:00.000Z",
      url: `https://fred.stlouisfed.org/series/${seriesId}`,
      licenseAttribution: "Test Fixture Only",
      copyrightedThirdParty: false,
      payloadSha256:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    },
    snapshot: {
      id: `snap_${seriesId}`,
      provider: "fred",
      seriesId,
      requestUrl: `https://fred.stlouisfed.org/series/${seriesId}`,
      retrievedAt: "2025-01-15T00:00:00.000Z",
      sha256:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      byteLength: 1024,
      rawJson: "[]",
    },
  };
}

test("1. No-Template & Static Guard: Zero hardcoded economic arrays, fallbackScope, fallbackGraph, or notebook defaults in src/", () => {
  const srcRoot = path.join(process.cwd(), "src");

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        out.push(...walk(full));
      } else if (full.endsWith(".ts") || full.endsWith(".tsx")) {
        out.push(full);
      }
    }
    return out;
  }

  const files = walk(srcRoot);
  const forbiddenPatterns = [
    { name: "benchmarkValues array", re: /\bbenchmarkValues\b/ },
    { name: "CANONICAL_FRED_SERIES table", re: /\bCANONICAL_FRED_SERIES\b/ },
    { name: "FALLBACK_MACRO_SERIES array", re: /\bFALLBACK_MACRO_SERIES\b/ },
    { name: "DOMAIN_TEMPLATES table", re: /\bDOMAIN_TEMPLATES\b/ },
    { name: "policyShockProfile array", re: /\bpolicyShockProfile\b/ },
    { name: "impulseCurve array", re: /\bimpulseCurve\b/ },
    { name: "historicalBase array", re: /\bhistoricalBase\b/ },
    { name: "fallbackScope template", re: /\bfunction fallbackScope\b/ },
    { name: "fallbackGraph template", re: /\bfunction fallbackGraph\b/ },
  ];

  for (const file of files) {
    const content = readFileSync(file, "utf8");
    for (const pat of forbiddenPatterns) {
      assert.equal(
        pat.re.test(content),
        false,
        `Forbidden template/hardcoded pattern "${pat.name}" found in ${path.relative(process.cwd(), file)}`,
      );
    }
  }

  // Notebook and CSV exports refuse to generate when no estimate exists (no GDPC1/2018/2012 defaults)
  const emptyModel = buildRunEconomicModel({
    question: "Test question",
    scope: null,
    nodes: [],
    fredSeries: [],
  });
  assert.throws(
    () =>
      buildCsvBundleContent({
        title: "Empty Run",
        seriesList: [],
        econModel: emptyModel,
      }),
    /no live econometric estimate exists/i,
  );
  assert.throws(
    () =>
      buildJupyterNotebookObject({
        runId: "run_empty",
        title: "Empty Run",
        scope: null,
        seriesList: [],
        econModel: emptyModel,
        nodes: [],
        bibliography: [],
      }),
    /no live econometric estimate exists/i,
  );
  assert.ok(PINNED_PYTHON_PACKAGES.every((pkg) => pkg.includes("==")));
});

test("2. Cookie-Bound Workspace Security: 403 on forged cookie or mismatched client ID, and fail-closed 503 without SESSION_SECRET in production", async () => {
  const testSecret = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
  const validUid = "123e4567-e89b-42d3-a456-426614174000";
  const otherUid = "987e6543-e21b-42d3-a456-426614174999";
  const validCookie = `${validUid}.${signSessionUserId(validUid, testSecret)}`;

  // 1) Production without SESSION_SECRET fails closed (503 SessionConfigError)
  await assert.rejects(
    () =>
      evaluateWorkspaceSession({
        rawCookie: null,
        nodeEnv: "production",
        configuredSecret: "",
      }),
    (err: unknown) =>
      err instanceof SessionConfigError && err.status === 503,
  );

  // 2) Forged cookie signature is rejected with 403 SessionForbiddenError
  await assert.rejects(
    () =>
      evaluateWorkspaceSession({
        rawCookie: `${validUid}.${"0".repeat(64)}`,
        nodeEnv: "production",
        configuredSecret: testSecret,
      }),
    (err: unknown) =>
      err instanceof SessionForbiddenError && err.status === 403,
  );

  // 3) Client-supplied workspace ID without a signed cookie is rejected with 403
  await assert.rejects(
    () =>
      evaluateWorkspaceSession({
        rawCookie: null,
        clientSuppliedId: validUid,
        nodeEnv: "production",
        configuredSecret: testSecret,
      }),
    (err: unknown) =>
      err instanceof SessionForbiddenError && err.status === 403,
  );

  // 4) Client-supplied workspace ID that mismatches the signed cookie is rejected with 403
  await assert.rejects(
    () =>
      evaluateWorkspaceSession({
        rawCookie: validCookie,
        clientSuppliedId: otherUid,
        nodeEnv: "production",
        configuredSecret: testSecret,
      }),
    (err: unknown) =>
      err instanceof SessionForbiddenError && err.status === 403,
  );

  // 5) Valid signed cookie is accepted and returns exact userId with Secure=true in production
  const verified = await evaluateWorkspaceSession({
    rawCookie: validCookie,
    nodeEnv: "production",
    configuredSecret: testSecret,
  });
  assert.equal(verified.userId, validUid);
  assert.equal(verified.isNewSession, false);
  assert.equal(verified.cookieOptions.httpOnly, true);
  assert.equal(verified.cookieOptions.secure, true);
  assert.equal(verified.cookieOptions.sameSite, "lax");
});

test("3. Method Honesty: DiD, Synthetic Control & Event Study relabel to Descriptive without comparison/donor data, and retain Quasi-experimental with donors", () => {
  const fixture = makeKnownStepFixture();
  const comp1: FetchedSeriesBundle = {
    ...fixture,
    metadata: { ...fixture.metadata, id: "TEST_DONOR_1" },
    observations: fixture.observations.map((pt, idx) => ({
      date: pt.date,
      value: +(100 + 0.5 * idx + (idx % 2 === 0 ? 0.15 : -0.15)).toFixed(4),
    })),
  };
  const comp2: FetchedSeriesBundle = {
    ...fixture,
    metadata: { ...fixture.metadata, id: "TEST_DONOR_2" },
    observations: fixture.observations.map((pt, idx) => ({
      date: pt.date,
      value: +(100 + 0.5 * idx + (idx % 2 === 0 ? 0.1 : -0.1)).toFixed(4),
    })),
  };

  // Single-series DiD without comparison series -> relabeled Descriptive
  const didSingle = executeEconometricEstimate({
    method: "did_twfe",
    outcome: fixture,
    policyDate: "2018-01-01",
    scopeId: "scope_honesty",
  });
  assert.equal(didSingle.honestyTier, "Descriptive");
  assert.ok(didSingle.relabelReason?.includes("Difference-in-Differences"));

  // Single-series Synthetic Control without donor pool -> relabeled Descriptive
  const scSingle = executeEconometricEstimate({
    method: "synthetic_control",
    outcome: fixture,
    donors: [comp1], // only 1 donor, needs >= 2
    policyDate: "2018-01-01",
    scopeId: "scope_honesty",
  });
  assert.equal(scSingle.honestyTier, "Descriptive");
  assert.ok(scSingle.relabelReason?.includes("Synthetic Control"));

  // Single-series Event Study -> relabeled Descriptive (never Quasi-experimental on single series)
  const esSingle = executeEconometricEstimate({
    method: "event_study",
    outcome: fixture,
    policyDate: "2018-01-01",
    scopeId: "scope_honesty",
  });
  assert.equal(esSingle.honestyTier, "Descriptive");
  assert.ok(esSingle.relabelReason?.includes("Single-series"));

  // DiD with comparison series -> retains Quasi-experimental (Difference-in-Differences)
  const didWithComp = executeEconometricEstimate({
    method: "did_twfe",
    outcome: fixture,
    donors: [comp1],
    policyDate: "2018-01-01",
    scopeId: "scope_honesty",
  });
  assert.equal(didWithComp.honestyTier, "Quasi-experimental");
  assert.equal(
    didWithComp.honestyLabel,
    "Quasi-experimental (Difference-in-Differences)",
  );
  assert.ok(Math.abs(didWithComp.pointEstimate - 12.0) < 0.6);

  // Synthetic Control with >= 2 donor series -> retains Quasi-experimental (Synthetic Control)
  const scWithDonors = executeEconometricEstimate({
    method: "synthetic_control",
    outcome: fixture,
    donors: [comp1, comp2],
    policyDate: "2018-01-01",
    scopeId: "scope_honesty",
  });
  assert.equal(scWithDonors.honestyTier, "Quasi-experimental");
  assert.equal(
    scWithDonors.honestyLabel,
    "Quasi-experimental (Synthetic Control)",
  );
  assert.ok(Math.abs(scWithDonors.pointEstimate - 12.0) < 0.6);
});

test("4. Pre-Fetch Lock Ordering, Browser/Crew Estimate Parity & Compiled Report Auditing", () => {
  // 1) Pre-registration lock created BEFORE observations are fetched
  const preFetchTimestamp = "2025-01-15T00:00:00.000Z";
  const preLock = createPreRegistrationLock({
    scopeId: "scope_parity",
    outcomeSeriesId: "TEST_PNFI",
    comparisonSeriesIds: ["TEST_COMP"],
    selectionRulesSummary: "Pre-registered before observation pull",
    transform: "lin",
    method: "did_twfe",
    windowStart: "2012-01-01",
    windowEnd: "2024-10-01",
    policyDate: "2018-01-01",
    hacLags: 4,
    lockedAt: preFetchTimestamp,
  });

  // 2) Observations fetched after lock timestamp
  const fixture = makeKnownStepFixture();
  fixture.provenance.retrievedAt = "2025-01-15T00:00:05.000Z";
  assert.ok(preLock.lockedAt < fixture.provenance.retrievedAt);

  const compFixture: FetchedSeriesBundle = {
    ...fixture,
    metadata: { ...fixture.metadata, id: "TEST_COMP" },
    observations: fixture.observations.map((pt, idx) => ({
      date: pt.date,
      value: +(100 + 0.5 * idx + (idx % 2 === 0 ? 0.15 : -0.15)).toFixed(4),
    })),
  };

  const crewEstimate = executeEconometricEstimate({
    method: "did_twfe",
    outcome: fixture,
    donors: [compFixture],
    policyDate: "2018-01-01",
    scopeId: "scope_parity",
    preRegistrationLock: preLock,
  });
  const crewRobustness = runAutomaticRobustnessSuite({
    headline: crewEstimate,
    outcome: fixture,
    donors: [compFixture],
    scopeId: "scope_parity",
  });

  assert.equal(crewEstimate.spec.preRegistration.lockHash, preLock.lockHash);
  assert.equal(crewEstimate.spec.preRegistration.lockedAt, preFetchTimestamp);

  // 3) Browser model reconstructed from storedEstimates matches Crew estimate 100%
  const browserModel = buildRunEconomicModel({
    question: "TCJA investment",
    scope: null,
    nodes: [],
    fredSeries: [
      {
        key: "TEST_PNFI",
        seriesId: "TEST_PNFI",
        title: fixture.metadata.title,
        units: fixture.metadata.units,
        nodeTitle: "Evidence",
        points: fixture.observations,
      },
    ],
    storedEstimates: [crewEstimate],
    storedRobustness: [crewRobustness],
    preRegistrationLock: preLock,
  });

  assert.equal(browserModel.headlineEstimate?.id, crewEstimate.id);
  assert.equal(
    browserModel.headlineEstimate?.pointEstimate,
    crewEstimate.pointEstimate,
  );
  assert.equal(
    browserModel.headlineEstimate?.standardError,
    crewEstimate.standardError,
  );
  assert.equal(
    browserModel.scorecard.preRegistrationHash,
    preLock.lockHash.slice(0, 12),
  );
  assert.equal(
    browserModel.scorecard.preRegistrationLockedAt,
    preFetchTimestamp,
  );

  // 4) Compiled AI report runs through Data Auditor and strips untraced numbers
  const rawReport = {
    title: "Test Report",
    subtitle: "US · 2012-2024",
    projectTitle: "Project",
    preparedAt: new Date().toISOString(),
    executiveSummary: `The DiD estimate on TEST_PNFI is ${crewEstimate.pointEstimate} (SE = ${crewEstimate.standardError}), whereas an untraced claim says 83.42%.`,
    keyFindings: [
      {
        nodeType: "Core Claim",
        headline: "Investment rose",
        detail: `Verified β = ${crewEstimate.pointEstimate}, unverified 419.77.`,
        status: "Supported",
        citationRef: "[claim_core]",
      },
    ],
    spineNarrative: `Point estimate ${crewEstimate.pointEstimate}.`,
    figureNotes: [],
    incidenceRows: [],
    methodologyAndTrace: `N = ${crewEstimate.sampleSize} observations.`,
    risksAndCounterfactuals: "No untraced numbers here.",
  };

  const auditedReport = auditCompiledPolicyReport(rawReport, {
    fredSeries: [
      {
        key: "TEST_PNFI",
        seriesId: "TEST_PNFI",
        title: fixture.metadata.title,
        units: fixture.metadata.units,
        nodeTitle: "Evidence",
        points: fixture.observations,
      },
    ],
    estimates: [crewEstimate],
    robustness: [crewRobustness],
  });

  assert.ok(auditedReport.executiveSummary.includes(String(crewEstimate.pointEstimate)));
  assert.ok(!auditedReport.executiveSummary.includes("83.42%"));
  assert.ok(
    auditedReport.executiveSummary.includes(
      "[unverified number removed by Data Auditor]",
    ),
  );
  assert.ok(!auditedReport.keyFindings[0]!.detail.includes("419.77"));
});

test("5. Context-Bound Rounding-Aware Data Auditor: enforces decimal precision and series/date context", () => {
  assert.equal(isRoundingAwareMatch("12.0", 12.0, 12.02), true);
  assert.equal(isRoundingAwareMatch("12.00", 12.0, 12.02), false);
  assert.equal(isRoundingAwareMatch("12.2", 12.2, 12.0), false);

  const fixture = makeKnownStepFixture();
  const est = executeEconometricEstimate({
    method: "descriptive_newey_west",
    outcome: fixture,
    policyDate: "2018-01-01",
    scopeId: "scope_audit",
  });
  const registry = buildAllowedNumericRegistry({
    bundles: [fixture],
    estimates: [est],
  });

  // Interior observation at 2015-04-01 (index 13 -> value = 100 + 6.5 - 0.15 = 106.35)
  // Without citing the date 2015-04-01, citing 106.35 in prose is rejected!
  const uncitedInterior = auditGeneratedProseNumbers(
    "The policy caused an index level of 106.35 in the market.",
    registry,
    { stripUntraced: true },
  );
  assert.equal(uncitedInterior.passed, false);

  // When the sentence explicitly cites 2015-04-01 and TEST_PNFI, 106.35 is accepted!
  const citedInterior = auditGeneratedProseNumbers(
    "On 2015-04-01, series TEST_PNFI recorded a level of 106.35.",
    registry,
    { stripUntraced: true },
  );
  assert.equal(citedInterior.passed, true);
  assert.equal(citedInterior.untracedNumbers.length, 0);
});

test("6. 20-Question CI Benchmark Runner over recorded fixtures (0 live API calls in CI)", () => {
  assert.equal(POLICY_BENCHMARK_SUITE.length, 20);

  const scores = POLICY_BENCHMARK_SUITE.map((item: PolicyBenchmarkItem) => {
    const policyYear = Number.parseInt(item.policyDate.slice(0, 4), 10);
    const midpointEffect = +(
      (item.literatureEffectRange[0] + item.literatureEffectRange[1]) /
      2
    ).toFixed(3);
    const leadKeyword = item.expectedOutcomeKeywords[0] ?? "SERIES";

    const outcomeBundle = makeKnownStepFixture({
      seriesId: `BENCH_${leadKeyword.toUpperCase()}`,
      title: `Benchmark ${item.expectedOutcomeKeywords.join(" ")} Series`,
      policyYear,
      jump: midpointEffect,
    });
    const compBundle: FetchedSeriesBundle = {
      ...outcomeBundle,
      metadata: {
        ...outcomeBundle.metadata,
        id: `COMP_${leadKeyword.toUpperCase()}`,
      },
      observations: outcomeBundle.observations.map((pt, idx) => ({
        date: pt.date,
        value: +(100 + 0.5 * idx + (idx % 2 === 0 ? 0.15 : -0.15)).toFixed(4),
      })),
    };

    return evaluateBenchmarkQuestion({
      item,
      outcomeBundle,
      comparisonBundle: compBundle,
    });
  });

  const summary = summarizeBenchmarkSuite(scores);
  assert.equal(summary.totalQuestions, 20);
  assert.equal(summary.seriesRelevanceRate, 1);
  assert.equal(summary.directionAgreementRate, 1);
  assert.equal(summary.magnitudeInRangeRate, 1);
  assert.equal(summary.meanAuditorStripRate, 0);
});
