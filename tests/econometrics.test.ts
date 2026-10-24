import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  auditGeneratedProseNumbers,
  buildAllowedNumericRegistry,
} from "../src/lib/economics/auditor";
import {
  createPreRegistrationLock,
  executeEconometricEstimate,
  runAutomaticRobustnessSuite,
} from "../src/lib/economics/estimators";
import { evaluateSpecificationFork, buildDefaultSkepticForks } from "../src/lib/economics/forks";
import {
  fitOlsHac,
  runStationarityTests,
  solveSyntheticControlWeights,
} from "../src/lib/economics/math";
import { convertFrequency } from "../src/lib/data/harmonize";
import {
  deriveObservationWindow,
  validateCandidateMetadata,
} from "../src/lib/data/selector";
import type { FetchedSeriesBundle, ObservationPoint } from "../src/lib/data/types";
import { POLICY_BENCHMARK_SUITE } from "../src/lib/evaluation/benchmarks";
import {
  extractEstimateFromAbstract,
  reconstructAbstract,
} from "../src/lib/mcp/openalex";
import { evaluateClaimStatusFromEstimate } from "../src/schemas/digression";

/**
 * Test-only fixture generator (lives strictly in tests/, never in app code).
 * Generates a known-answer deterministic step-shift series:
 * Pre-policy (2012..2017): y_t = 100 + 0.5*t + (-1)^t * 0.2
 * Post-policy (2018..2024): y_t = 100 + 12.0 + 0.5*t + (-1)^t * 0.2 (true jump = +12.0)
 */
function makeKnownStepFixture(): FetchedSeriesBundle {
  const observations: ObservationPoint[] = [];
  let idx = 0;
  for (let year = 2012; year <= 2024; year += 1) {
    for (const month of ["01", "04", "07", "10"]) {
      const date = `${year}-${month}-01`;
      const isPost = year >= 2018;
      const noise = idx % 2 === 0 ? 0.2 : -0.2;
      const value = 100 + 0.5 * idx + (isPost ? 12.0 : 0) + noise;
      observations.push({ date, value });
      idx += 1;
    }
  }

  return {
    metadata: {
      provider: "fred",
      id: "TEST_PNFI",
      title: "Fixture Real Private Nonresidential Fixed Investment",
      units: "Billions of Chained 2017 Dollars",
      frequency: "Quarterly",
      frequencyShort: "q",
      seasonalAdjustment: "Seasonally Adjusted Annual Rate",
      observationStart: "2012-01-01",
      observationEnd: "2024-10-01",
      lastUpdated: "2025-01-15",
      discontinued: false,
      copyrightedThirdParty: false,
      licenseAttribution: "Test Fixture Only",
      sourceUrl: "https://fred.stlouisfed.org/series/PNFI",
    },
    observations,
    provenance: {
      source: "fred",
      seriesId: "TEST_PNFI",
      title: "Fixture Real Private Nonresidential Fixed Investment",
      units: "Billions of Chained 2017 Dollars",
      transform: "lin — Levels",
      seasonalAdjustment: "Seasonally Adjusted Annual Rate",
      frequency: "Quarterly",
      observationWindow: { start: "2012-01-01", end: "2024-10-01" },
      vintageDate: "2025-01-15",
      lastUpdated: "2025-01-15",
      retrievedAt: "2025-01-15T00:00:00.000Z",
      url: "https://fred.stlouisfed.org/series/PNFI",
      licenseAttribution: "Test Fixture Only",
      copyrightedThirdParty: false,
      payloadSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    },
    snapshot: {
      id: "snap_test_pnfi",
      provider: "fred",
      seriesId: "TEST_PNFI",
      requestUrl: "https://fred.stlouisfed.org/series/PNFI",
      retrievedAt: "2025-01-15T00:00:00.000Z",
      sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      byteLength: 1024,
      rawJson: "[]",
    },
  };
}

test("1. Static Guard: Zero hardcoded economic benchmark arrays or domain templates in src/", () => {
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
  ];

  for (const file of files) {
    const content = readFileSync(file, "utf8");
    for (const pat of forbiddenPatterns) {
      assert.equal(
        pat.re.test(content),
        false,
        `Forbidden hardcoded economic pattern "${pat.name}" found in ${path.relative(process.cwd(), file)}`,
      );
    }
  }
});

test("2. OLS with Newey-West HAC recovers known step shift (+12.0) with p < 0.001", () => {
  const fixture = makeKnownStepFixture();
  const est = executeEconometricEstimate({
    method: "event_study",
    outcome: fixture,
    policyDate: "2018-01-01",
    scopeId: "scope_tcja_test",
  });

  assert.ok(
    Math.abs(est.pointEstimate - 12.0) < 0.5,
    `Expected point estimate near +12.0, got ${est.pointEstimate}`,
  );
  assert.ok(est.ciLower > 10.5 && est.ciUpper < 13.5);
  assert.ok(est.pValue < 0.001);
  assert.equal(est.honestyLabel, "Quasi-experimental (Event Study)");
  assert.ok((est.eventStudyPath?.length ?? 0) >= 6);
  assert.ok((est.localProjectionsPath?.length ?? 0) >= 4);
  assert.ok((est.counterfactualPath?.length ?? 0) === fixture.observations.length);
});

test("3. Automatic Robustness Suite & Specification Forks preserve sign on known step shift", () => {
  const fixture = makeKnownStepFixture();
  const headline = executeEconometricEstimate({
    method: "event_study",
    outcome: fixture,
    policyDate: "2018-01-01",
    scopeId: "scope_tcja_test",
  });

  const robustness = runAutomaticRobustnessSuite({
    headline,
    outcome: fixture,
    scopeId: "scope_tcja_test",
  });

  assert.equal(robustness.signFlipped, false);
  assert.ok(robustness.passRate >= 0.75);
  assert.ok(robustness.specs.length >= 4);

  const forks = buildDefaultSkepticForks(headline);
  assert.ok(forks.length >= 3);
  const forkResult = evaluateSpecificationFork({
    baseline: headline,
    outcome: fixture,
    fork: forks[0]!,
    scopeId: "scope_tcja_test",
  });
  assert.equal(
    forkResult.forkEstimate.spec.preRegistration.forkParentHash,
    headline.spec.preRegistration.lockHash,
  );
});

test("4. Claim Status Lifecycle Rule: sets supported / contradicted / inconclusive / unverifiable deterministically", () => {
  const fixture = makeKnownStepFixture();
  const headline = executeEconometricEstimate({
    method: "event_study",
    outcome: fixture,
    policyDate: "2018-01-01",
    scopeId: "scope_tcja_test",
  });
  const robustness = runAutomaticRobustnessSuite({
    headline,
    outcome: fixture,
    scopeId: "scope_tcja_test",
  });

  // Positive hypothesis matches +12.0 estimate -> supported
  const sup = evaluateClaimStatusFromEstimate({
    estimate: headline,
    robustness,
    hypothesizedDirection: "positive",
  });
  assert.equal(sup.status, "supported");
  assert.equal(sup.confidence, "high");

  // Negative hypothesis against +12.0 estimate -> contradicted
  const contra = evaluateClaimStatusFromEstimate({
    estimate: headline,
    robustness,
    hypothesizedDirection: "negative",
  });
  assert.equal(contra.status, "contradicted");

  // Missing data -> unverifiable
  const unv = evaluateClaimStatusFromEstimate({
    estimate: null,
    robustness: null,
    dataUnavailable: true,
    dataUnavailableReason: "Data unavailable: FRED_API_KEY not configured",
  });
  assert.equal(unv.status, "unverifiable");
  assert.equal(unv.confidence, "unknown");
});

test("5. Deterministic Numeric Auditor: accepts traced numbers and strips untraced numbers", () => {
  const fixture = makeKnownStepFixture();
  const headline = executeEconometricEstimate({
    method: "event_study",
    outcome: fixture,
    policyDate: "2018-01-01",
    scopeId: "scope_tcja_test",
  });

  const registry = buildAllowedNumericRegistry({
    bundles: [fixture],
    estimates: [headline],
  });

  const cleanProse = `In 2018, the event study estimate on [ev_fred] is ${headline.pointEstimate} with standard error ${headline.standardError} across N=${headline.sampleSize} observations.`;
  const cleanAudit = auditGeneratedProseNumbers(cleanProse, registry, {
    stripUntraced: true,
  });
  assert.equal(cleanAudit.passed, true);
  assert.equal(cleanAudit.untracedNumbers.length, 0);

  const hallucinatedProse = `The policy increased output by 47.83% and created 912,400 jobs [claim_core].`;
  const dirtyAudit = auditGeneratedProseNumbers(hallucinatedProse, registry, {
    stripUntraced: true,
  });
  assert.equal(dirtyAudit.passed, false);
  assert.equal(dirtyAudit.untracedNumbers.length, 2);
  assert.ok(
    dirtyAudit.sanitizedText.includes("[unverified number removed by Data Auditor]"),
  );
});

test("6. Synthetic Control simplex solver, Frequency Conversion, Window Derivation & OpenAlex Extractor", () => {
  // Simplex solver: target is 0.7 * donor1 + 0.3 * donor2
  const d1 = [10, 12, 14, 16, 18, 20];
  const d2 = [20, 20, 20, 20, 20, 20];
  const yPre = d1.map((v, i) => 0.7 * v + 0.3 * d2[i]!);
  const sc = solveSyntheticControlWeights(yPre, [d1, d2]);
  assert.equal(sc.weights.length, 2);
  assert.ok(Math.abs(sc.weights[0]! + sc.weights[1]! - 1) < 1e-3);
  assert.ok(sc.rmspePre < 0.5);

  // Frequency conversion: monthly to quarterly average
  const monthly: ObservationPoint[] = [
    { date: "2023-01-01", value: 10 },
    { date: "2023-02-01", value: 20 },
    { date: "2023-03-01", value: 30 },
  ];
  const quarterly = convertFrequency(monthly, "q", "avg");
  assert.equal(quarterly.length, 1);
  assert.equal(quarterly[0]?.date, "2023-01-01");
  assert.equal(quarterly[0]?.value, 20);

  // Window derivation for TCJA (2018) starts at or before 2012
  const win = deriveObservationWindow({
    question: "Did the 2017 TCJA increase business investment?",
  });
  assert.equal(win.policyDate, "2018-01-01");
  assert.ok(Number.parseInt(win.observationStart.slice(0, 4), 10) <= 2012);

  // OpenAlex inverted index reconstruction & quote-backed extraction
  const abstract = reconstructAbstract({
    We: [0],
    estimate: [1],
    a: [2],
    tariff: [3],
    "pass-through": [4],
    elasticity: [5],
    of: [6],
    "0.68": [7],
    with: [8],
    standard: [9],
    error: [10],
    "0.09.": [11],
  });
  const extracted = extractEstimateFromAbstract({}, abstract);
  assert.equal(extracted.pointEstimate, 0.68);
  assert.ok(extracted.quoteSpan?.includes("0.68"));

  // Benchmark suite has at least 20 well-established policy questions
  assert.ok(POLICY_BENCHMARK_SUITE.length >= 20);
});
