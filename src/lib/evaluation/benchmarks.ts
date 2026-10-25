import type { FetchedSeriesBundle } from "@/lib/data/types";
import {
  auditGeneratedProseNumbers,
  buildAllowedNumericRegistry,
} from "@/lib/economics/auditor";
import {
  executeEconometricEstimate,
  runAutomaticRobustnessSuite,
} from "@/lib/economics/estimators";

/**
 * PoliNote Policy Econometrics Benchmark Suite (20 Literature-Backed Policy Questions).
 * Used for nightly / CI evaluation of:
 * - Series selection relevance & pre/post window coverage
 * - Direction agreement & magnitude within peer-reviewed literature range
 * - Share of claims traced to empirical evidence
 * - Deterministic Data Auditor strip/mismatch rate (target = 0)
 */

export type PolicyBenchmarkItem = {
  id: string;
  category:
    | "trade_tariffs"
    | "fiscal_tax"
    | "labor_wages"
    | "monetary_inflation"
    | "housing_urban"
    | "industrial_climate";
  question: string;
  policyDate: string;
  expectedOutcomeKeywords: string[];
  expectedDirection: "positive" | "negative" | "ambiguous";
  literatureCitation: string;
  literatureEffectRange: [number, number];
  units: string;
};

export const POLICY_BENCHMARK_SUITE: readonly PolicyBenchmarkItem[] = [
  {
    id: "tcja_2017_investment",
    category: "fiscal_tax",
    question:
      "Did the 2017 Tax Cuts and Jobs Act (TCJA) increase US real private nonresidential fixed investment?",
    policyDate: "2018-01-01",
    expectedOutcomeKeywords: ["nonresidential", "investment", "PNFI", "GPDIC1"],
    expectedDirection: "positive",
    literatureCitation: "Chodorow-Reich, Zidar, Zwick (2024 AER); Kennedy et al. (2024)",
    literatureEffectRange: [2.0, 20.0],
    units: "% change in corporate / nonresidential investment",
  },
  {
    id: "us_tariffs_2018_import_prices",
    category: "trade_tariffs",
    question:
      "What was the pass-through of the 2018–2019 US Section 232 and 301 tariffs into US import prices?",
    policyDate: "2018-03-01",
    expectedOutcomeKeywords: ["import", "price", "IMPGS", "IR"],
    expectedDirection: "positive",
    literatureCitation: "Amiti, Redding, Weinstein (2019 JEP); Fajgelbaum et al. (2020 QJE)",
    literatureEffectRange: [0.5, 1.05],
    units: "pass-through elasticity to duty-inclusive import prices",
  },
  {
    id: "us_tariffs_2018_manufacturing_emp",
    category: "trade_tariffs",
    question:
      "How did the 2018–2019 steel, aluminum, and China tariffs affect total US manufacturing employment?",
    policyDate: "2018-03-01",
    expectedOutcomeKeywords: ["manufacturing", "employment", "MANEMP"],
    expectedDirection: "negative",
    literatureCitation: "Flaaen & Pierce (2019 Fed Board); Autor et al. (2024)",
    literatureEffectRange: [-2.5, 0.5],
    units: "% net effect on manufacturing employment",
  },
  {
    id: "volcker_disinflation_1979",
    category: "monetary_inflation",
    question:
      "How did the October 1979 Volcker monetary policy tightening affect US CPI inflation and unemployment?",
    policyDate: "1979-10-01",
    expectedOutcomeKeywords: ["inflation", "cpi", "unemployment", "CPIAUCSL", "UNRATE"],
    expectedDirection: "negative",
    literatureCitation: "Romer & Romer (1989, 2004 AER); Goodfriend & King (2005)",
    literatureEffectRange: [-8.0, -2.0],
    units: "percentage-point reduction in CPI inflation over 3 years",
  },
  {
    id: "fed_tightening_2022_cpi",
    category: "monetary_inflation",
    question:
      "How did the Federal Reserve's 2022–2023 federal funds rate tightening cycle affect US headline CPI inflation?",
    policyDate: "2022-03-01",
    expectedOutcomeKeywords: ["CPIAUCSL", "FEDFUNDS", "inflation"],
    expectedDirection: "negative",
    literatureCitation: "Bernanke & Blanchard (2023); Bauer & Swanson (2023)",
    literatureEffectRange: [-6.0, -1.5],
    units: "percentage-point change in year-over-year CPI inflation",
  },
  {
    id: "fed_tightening_2022_housing_starts",
    category: "housing_urban",
    question:
      "What was the effect of the 2022 mortgage rate surge on US privately-owned housing units started?",
    policyDate: "2022-03-01",
    expectedOutcomeKeywords: ["HOUST", "housing", "starts"],
    expectedDirection: "negative",
    literatureCitation: "Glaeser & Gyourko (2018); Fonseca & Liu (2023)",
    literatureEffectRange: [-25.0, -5.0],
    units: "% change in housing starts",
  },
  {
    id: "chips_ira_2022_manufacturing_construction",
    category: "industrial_climate",
    question:
      "Did the August 2022 CHIPS and Science Act and Inflation Reduction Act increase US manufacturing construction spending?",
    policyDate: "2022-08-01",
    expectedOutcomeKeywords: ["construction", "manufacturing", "TLMFGCONS", "INDPRO"],
    expectedDirection: "positive",
    literatureCitation: "U.S. Treasury (2023); Bistline, Mehrotra, Wolfram (2023 Brookings)",
    literatureEffectRange: [20.0, 120.0],
    units: "% increase in real manufacturing construction spending",
  },
  {
    id: "minimum_wage_hospitality_employment",
    category: "labor_wages",
    question:
      "What is the effect of statutory minimum wage increases on low-wage hospitality employment and earnings?",
    policyDate: "2016-01-01",
    expectedOutcomeKeywords: ["employment", "wage", "earnings", "UNRATE", "PAYEMS"],
    expectedDirection: "ambiguous",
    literatureCitation: "Cengiz, Dube, Lindner, Zipperer (2019 QJE); Neumark & Shirley (2022)",
    literatureEffectRange: [-0.25, 0.08],
    units: "own-wage employment elasticity",
  },
  {
    id: "cares_arpa_fiscal_stimulus_gdp",
    category: "fiscal_tax",
    question:
      "How did the 2020–2021 pandemic fiscal relief packages affect US real GDP recovery relative to pre-2020 trends?",
    policyDate: "2020-04-01",
    expectedOutcomeKeywords: ["GDPC1", "gdp", "output"],
    expectedDirection: "positive",
    literatureCitation: "Chodorow-Reich (2019); Soyres, Santacreu, Young (2022)",
    literatureEffectRange: [1.5, 6.5],
    units: "% real GDP boost",
  },
  {
    id: "aca_medicaid_expansion_2014",
    category: "fiscal_tax",
    question:
      "How did the 2014 Affordable Care Act Medicaid expansion affect uninsurance rates and healthcare employment?",
    policyDate: "2014-01-01",
    expectedOutcomeKeywords: ["health", "employment", "insurance"],
    expectedDirection: "positive",
    literatureCitation: "Sommers et al. (2017); Miller, Johnson, Wherry (2021 QJE)",
    literatureEffectRange: [2.0, 9.0],
    units: "percentage-point increase in coverage / sector growth",
  },
  {
    id: "china_wto_pntr_2001_manufacturing",
    category: "trade_tariffs",
    question:
      "How did granting Permanent Normal Trade Relations (PNTR) to China in 2001 affect US manufacturing employment?",
    policyDate: "2001-12-01",
    expectedOutcomeKeywords: ["MANEMP", "manufacturing", "employment"],
    expectedDirection: "negative",
    literatureCitation: "Pierce & Schott (2016 AER); Autor, Dorn, Hanson (2013 AER)",
    literatureEffectRange: [-18.0, -5.0],
    units: "% decline in exposed manufacturing employment",
  },
  {
    id: "nafta_1994_trade_volumes",
    category: "trade_tariffs",
    question:
      "How did the 1994 North American Free Trade Agreement (NAFTA) affect US real imports and exports of goods and services?",
    policyDate: "1994-01-01",
    expectedOutcomeKeywords: ["IMPGS", "imports", "trade"],
    expectedDirection: "positive",
    literatureCitation: "Caliendo & Parro (2015 RES); Hakobyan & McLaren (2016)",
    literatureEffectRange: [10.0, 65.0],
    units: "% trade volume expansion",
  },
  {
    id: "transit_upzoning_housing_permits",
    category: "housing_urban",
    question:
      "How do state-level transit-oriented upzoning mandates affect multifamily building permits and corridor rent inflation?",
    policyDate: "2021-01-01",
    expectedOutcomeKeywords: ["PERMIT", "HOUST", "CUSR0000SEHA", "rent"],
    expectedDirection: "positive",
    literatureCitation: "Mast (2023 JUE); Greenaway-McGrevy & Phillips (2023)",
    literatureEffectRange: [5.0, 40.0],
    units: "% increase in permitted multifamily units",
  },
  {
    id: "qe_lsap_2008_treasury_yields",
    category: "monetary_inflation",
    question:
      "How did the Federal Reserve's Large-Scale Asset Purchases (QE1 in 2008–2009) affect 10-year US Treasury yields?",
    policyDate: "2008-11-01",
    expectedOutcomeKeywords: ["DGS10", "treasury", "yield"],
    expectedDirection: "negative",
    literatureCitation: "Krishnamurthy & Vissing-Jorgensen (2011 BPEA); Gagnon et al. (2011)",
    literatureEffectRange: [-1.2, -0.25],
    units: "percentage-point change in 10-year Treasury yield",
  },
  {
    id: "arra_2009_stimulus_employment",
    category: "fiscal_tax",
    question:
      "What was the effect of the 2009 American Recovery and Reinvestment Act (ARRA) on US nonfarm payroll employment?",
    policyDate: "2009-02-01",
    expectedOutcomeKeywords: ["PAYEMS", "UNRATE", "employment"],
    expectedDirection: "positive",
    literatureCitation: "Feyrer & Sacerdote (2011); Chodorow-Reich et al. (2012 AEJ:Economic Policy)",
    literatureEffectRange: [1.0, 3.5],
    units: "% employment / state fiscal multiplier",
  },
  {
    id: "bush_steel_tariffs_2002",
    category: "trade_tariffs",
    question:
      "How did the 2002 Section 201 safeguard steel tariffs affect US industrial production and manufacturing employment?",
    policyDate: "2002-03-01",
    expectedOutcomeKeywords: ["INDPRO", "MANEMP", "steel"],
    expectedDirection: "negative",
    literatureCitation: "USITC (2003); Francois & Baughman (2003)",
    literatureEffectRange: [-1.5, 0.2],
    units: "% change in downstream manufacturing employment",
  },
  {
    id: "jgtrra_2003_dividend_tax_cut",
    category: "fiscal_tax",
    question:
      "Did the 2003 Jobs and Growth Tax Relief Reconciliation Act (JGTRRA) dividend tax cut increase corporate investment?",
    policyDate: "2003-05-01",
    expectedOutcomeKeywords: ["PNFI", "investment", "GDPC1"],
    expectedDirection: "ambiguous",
    literatureCitation: "Yagan (2015 AER); Chetty & Saez (2005 QJE)",
    literatureEffectRange: [-1.0, 3.0],
    units: "investment elasticity to dividend tax cut",
  },
  {
    id: "eu_cbam_2023_trade_emissions",
    category: "industrial_climate",
    question:
      "How does the Carbon Border Adjustment Mechanism (CBAM) affect basic material import prices and carbon leakage?",
    policyDate: "2023-10-01",
    expectedOutcomeKeywords: ["IMPGS", "INDPRO", "import"],
    expectedDirection: "positive",
    literatureCitation: "Böhringer et al. (2022 Nature Climate Change); Clausing & Wolfram (2023)",
    literatureEffectRange: [1.5, 12.0],
    units: "% border price adjustment on carbon-intensive imports",
  },
  {
    id: "shale_revolution_2010_industrial_output",
    category: "industrial_climate",
    question:
      "How did the US shale gas boom after 2010 affect domestic industrial production and energy-intensive manufacturing?",
    policyDate: "2010-01-01",
    expectedOutcomeKeywords: ["INDPRO", "MANEMP", "industrial"],
    expectedDirection: "positive",
    literatureCitation: "Hausman & Kellogg (2015 BPEA); Feyrer, Mansur, Sacerdote (2017 AER)",
    literatureEffectRange: [1.5, 6.0],
    units: "% increase in energy-intensive manufacturing output",
  },
  {
    id: "covid_remote_work_2020_rent_cpi",
    category: "housing_urban",
    question:
      "How did the post-2020 remote-work shift affect the US Consumer Price Index for rent of primary residence?",
    policyDate: "2020-04-01",
    expectedOutcomeKeywords: ["CUSR0000SEHA", "CPIAUCSL", "rent"],
    expectedDirection: "positive",
    literatureCitation: "Mondragon & Wieland (2022 FRBSF); Howard, Liebersohn, Ozimek (2023)",
    literatureEffectRange: [3.0, 15.0],
    units: "% cumulative increase in housing rent index above pre-trend",
  },
];

export type BenchmarkQuestionScore = {
  benchmarkId: string;
  seriesRelevant: boolean;
  directionAgreed: boolean;
  magnitudeInRange: boolean;
  pointEstimate: number;
  honestyLabel: string;
  auditorStripRate: number;
};

export type BenchmarkSuiteSummary = {
  totalQuestions: number;
  seriesRelevanceRate: number;
  directionAgreementRate: number;
  magnitudeInRangeRate: number;
  meanAuditorStripRate: number;
  scores: BenchmarkQuestionScore[];
};

/**
 * Evaluates a single benchmark item given its outcome & comparison series bundles.
 * Scores series relevance, direction agreement, magnitude within the peer-reviewed
 * literature range, and the Data Auditor strip rate on synthesized prose.
 */
export function evaluateBenchmarkQuestion(input: {
  item: PolicyBenchmarkItem;
  outcomeBundle: FetchedSeriesBundle;
  comparisonBundle?: FetchedSeriesBundle;
}): BenchmarkQuestionScore {
  const { item, outcomeBundle, comparisonBundle } = input;
  const hay = `${outcomeBundle.metadata.id} ${outcomeBundle.metadata.title}`.toLowerCase();
  const seriesRelevant = item.expectedOutcomeKeywords.some((kw) =>
    hay.includes(kw.toLowerCase()),
  );

  const estimate = executeEconometricEstimate({
    method: comparisonBundle ? "did_twfe" : "event_study",
    outcome: outcomeBundle,
    donors: comparisonBundle ? [comparisonBundle] : undefined,
    policyDate: item.policyDate,
    scopeId: `bench_${item.id}`,
  });

  const robustness = runAutomaticRobustnessSuite({
    headline: estimate,
    outcome: outcomeBundle,
    donors: comparisonBundle ? [comparisonBundle] : undefined,
    scopeId: `bench_${item.id}`,
  });

  const [lowLit, highLit] = item.literatureEffectRange;
  const magnitudeInRange =
    estimate.pointEstimate >= lowLit && estimate.pointEstimate <= highLit;

  const sign = Math.sign(estimate.pointEstimate);
  const directionAgreed =
    item.expectedDirection === "ambiguous"
      ? magnitudeInRange
      : item.expectedDirection === "positive"
        ? sign > 0
        : sign < 0;

  const registry = buildAllowedNumericRegistry({
    bundles: [outcomeBundle],
    estimates: [estimate],
    robustness: [robustness],
  });

  const draftText = `For ${item.id} on series ${outcomeBundle.metadata.id}, the estimated effect is ${estimate.pointEstimate} (SE = ${estimate.standardError}, 95% CI [${estimate.ciLower}, ${estimate.ciUpper}], N = ${estimate.sampleSize}).`;
  const audit = auditGeneratedProseNumbers(draftText, registry, {
    stripUntraced: true,
  });
  const auditorStripRate =
    audit.totalNumbersChecked > 0
      ? audit.untracedNumbers.length / audit.totalNumbersChecked
      : 0;

  return {
    benchmarkId: item.id,
    seriesRelevant,
    directionAgreed,
    magnitudeInRange,
    pointEstimate: estimate.pointEstimate,
    honestyLabel: estimate.honestyLabel,
    auditorStripRate,
  };
}

export function summarizeBenchmarkSuite(
  scores: BenchmarkQuestionScore[],
): BenchmarkSuiteSummary {
  const n = Math.max(1, scores.length);
  const seriesRelevanceRate =
    scores.filter((s) => s.seriesRelevant).length / n;
  const directionAgreementRate =
    scores.filter((s) => s.directionAgreed).length / n;
  const magnitudeInRangeRate =
    scores.filter((s) => s.magnitudeInRange).length / n;
  const meanAuditorStripRate =
    scores.reduce((acc, s) => acc + s.auditorStripRate, 0) / n;

  return {
    totalQuestions: scores.length,
    seriesRelevanceRate: +seriesRelevanceRate.toFixed(4),
    directionAgreementRate: +directionAgreementRate.toFixed(4),
    magnitudeInRangeRate: +magnitudeInRangeRate.toFixed(4),
    meanAuditorStripRate: +meanAuditorStripRate.toFixed(4),
    scores,
  };
}
