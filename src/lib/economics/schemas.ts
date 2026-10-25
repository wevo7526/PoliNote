import { z } from "zod";
import { DataProvenanceSchema, ObservationPointSchema } from "@/lib/data/types";

export const EconometricMethodIdSchema = z.enum([
  "descriptive_newey_west",
  "chow_break_test",
  "bai_perron_break",
  "stationarity_adf_kpss",
  "arima_forecast_counterfactual",
  "local_projections_jorda",
  "var_svar",
  "granger_predictive",
  "event_study",
  "did_twfe",
  "synthetic_control",
  "rdd",
  "iv_2sls",
  "panel_fe_re",
]);

export type EconometricMethodId = z.infer<typeof EconometricMethodIdSchema>;

export const HonestyTierSchema = z.enum([
  "Descriptive",
  "Associational",
  "Quasi-experimental",
  "Literature estimate",
]);

export type HonestyTier = z.infer<typeof HonestyTierSchema>;

export const MethodImplementationStatusSchema = z.enum([
  "Working",
  "Partial",
  "Not yet",
]);

export type MethodImplementationStatus = z.infer<
  typeof MethodImplementationStatusSchema
>;

export const DiagnosticCheckItemSchema = z.object({
  name: z.string(),
  status: z.enum(["pass", "warn", "fail"]),
  statistic: z.number().optional(),
  pValue: z.number().optional(),
  summary: z.string(),
});

export type DiagnosticCheckItem = z.infer<typeof DiagnosticCheckItemSchema>;

export const EstimateDiagnosticsSchema = z.object({
  residualAutocorrelationP: z.number().optional(),
  heteroskedasticityP: z.number().optional(),
  preTrendFStat: z.number().optional(),
  preTrendPValue: z.number().optional(),
  rSquared: z.number().optional(),
  adfStat: z.number().optional(),
  adfPValue: z.number().optional(),
  kpssStat: z.number().optional(),
  firstStageFStat: z.number().optional(),
  rmspePre: z.number().optional(),
  rmspePost: z.number().optional(),
  structuralBreakDates: z.array(z.string()).optional(),
  checklist: z.array(DiagnosticCheckItemSchema),
});

export type EstimateDiagnostics = z.infer<typeof EstimateDiagnosticsSchema>;

export const PreRegistrationLockSchema = z.object({
  lockHash: z.string().min(16),
  lockedAt: z.string(),
  scopeId: z.string(),
  outcomeSeriesId: z.string(),
  comparisonSeriesIds: z.array(z.string()).default([]),
  selectionRulesSummary: z.string().default("Quality & pre/post window coverage validation"),
  transform: z.string(),
  method: EconometricMethodIdSchema,
  windowStart: z.string(),
  windowEnd: z.string(),
  policyDate: z.string().nullable(),
  hacLags: z.number().int().default(4),
  forkParentHash: z.string().optional(),
  forkReason: z.string().optional(),
});

export type PreRegistrationLock = z.infer<typeof PreRegistrationLockSchema>;

export const EstimationSpecSchema = z.object({
  specId: z.string().min(1),
  method: EconometricMethodIdSchema,
  requestedMethod: EconometricMethodIdSchema.optional(),
  formula: z.string().min(1),
  outcomeSeriesId: z.string().min(1),
  outcomeTitle: z.string().min(1),
  outcomeUnits: z.string().min(1),
  policyDate: z.string().nullable(),
  windowStart: z.string(),
  windowEnd: z.string(),
  transform: z.string().default("lin"),
  controls: z.array(z.string()).default([]),
  donorSeriesIds: z.array(z.string()).default([]),
  fixedEffects: z.array(z.string()).default([]),
  clustering: z.string().default("Newey-West HAC (lags=4)"),
  ciLevel: z.number().default(0.95),
  hacLags: z.number().int().default(4),
  lpHorizons: z.number().int().default(8),
  preRegistration: PreRegistrationLockSchema,
});

export type EstimationSpec = z.infer<typeof EstimationSpecSchema>;

export const EventStudyCoefficientSchema = z.object({
  relPeriod: z.number().int(),
  periodLabel: z.string(),
  estimate: z.number(),
  standardError: z.number(),
  ciLower: z.number(),
  ciUpper: z.number(),
  pValue: z.number(),
});

export type EventStudyCoefficient = z.infer<typeof EventStudyCoefficientSchema>;

export const LocalProjectionHorizonSchema = z.object({
  horizon: z.number().int().nonnegative(),
  horizonLabel: z.string(),
  irfEstimate: z.number(),
  standardError: z.number(),
  ciLower: z.number(),
  ciUpper: z.number(),
  pValue: z.number(),
  sampleSize: z.number().int().positive(),
});

export type LocalProjectionHorizon = z.infer<typeof LocalProjectionHorizonSchema>;

export const CounterfactualComparisonPointSchema = z.object({
  date: z.string(),
  actual: z.number(),
  counterfactual: z.number(),
  ciLower: z.number(),
  ciUpper: z.number(),
  isPostPolicy: z.boolean(),
  placeboGap: z.number().optional(),
});

export type CounterfactualComparisonPoint = z.infer<
  typeof CounterfactualComparisonPointSchema
>;

export const EconometricEstimateSchema = z.object({
  id: z.string().min(1),
  method: EconometricMethodIdSchema,
  requestedMethod: EconometricMethodIdSchema.optional(),
  methodLabel: z.string().min(1),
  implementationStatus: MethodImplementationStatusSchema.default("Working"),
  honestyTier: HonestyTierSchema,
  honestyLabel: z.string().min(1),
  relabelReason: z.string().optional(),
  executionEngine: z.enum(["typescript-hac", "python-statsmodels"]).default("typescript-hac"),
  pointEstimate: z.number(),
  standardError: z.number().nonnegative(),
  ciLower: z.number(),
  ciUpper: z.number(),
  ciLevel: z.number(),
  seMethod: z.string(),
  tStat: z.number(),
  pValue: z.number().min(0).max(1),
  sampleSize: z.number().int().positive(),
  sampleWindow: z.object({
    start: z.string(),
    end: z.string(),
  }),
  effectUnits: z.string(),
  spec: EstimationSpecSchema,
  diagnostics: EstimateDiagnosticsSchema,
  assumptions: z.array(z.string()),
  threatsToValidity: z.array(z.string()),
  provenance: DataProvenanceSchema,
  eventStudyPath: z.array(EventStudyCoefficientSchema).optional(),
  localProjectionsPath: z.array(LocalProjectionHorizonSchema).optional(),
  counterfactualPath: z.array(CounterfactualComparisonPointSchema).optional(),
  donorWeights: z
    .array(z.object({ unit: z.string(), weight: z.number() }))
    .optional(),
});

export type EconometricEstimate = z.infer<typeof EconometricEstimateSchema>;

export const SpecificationCurvePointSchema = z.object({
  specId: z.string(),
  label: z.string(),
  dimension: z.enum([
    "baseline",
    "window_narrow",
    "window_extended",
    "transform_log",
    "transform_diff",
    "controls_included",
    "placebo_in_time",
    "leave_one_out",
  ]),
  pointEstimate: z.number(),
  standardError: z.number(),
  ciLower: z.number(),
  ciUpper: z.number(),
  pValue: z.number(),
  sampleSize: z.number().int(),
  isPlacebo: z.boolean().default(false),
});

export type SpecificationCurvePoint = z.infer<
  typeof SpecificationCurvePointSchema
>;

export const RobustnessBundleSchema = z.object({
  headlineEstimateId: z.string(),
  specs: z.array(SpecificationCurvePointSchema),
  signFlipped: z.boolean(),
  significanceFlipped: z.boolean(),
  placeboPassed: z.boolean(),
  passRate: z.number().min(0).max(1),
  summary: z.string(),
});

export type RobustnessBundle = z.infer<typeof RobustnessBundleSchema>;

export const NumericAuditEntrySchema = z.object({
  rawToken: z.string(),
  numericValue: z.number(),
  matchedReferenceId: z.string().nullable(),
  matchedSourceLabel: z.string().nullable(),
  passed: z.boolean(),
});

export type NumericAuditEntry = z.infer<typeof NumericAuditEntrySchema>;

export const NumericAuditReportSchema = z.object({
  passed: z.boolean(),
  totalNumbersChecked: z.number().int().nonnegative(),
  matchedCount: z.number().int().nonnegative(),
  untracedNumbers: z.array(NumericAuditEntrySchema),
  entries: z.array(NumericAuditEntrySchema),
  sanitizedText: z.string(),
});

export type NumericAuditReport = z.infer<typeof NumericAuditReportSchema>;

export type MethodCatalogDescriptor = {
  id: EconometricMethodId;
  label: string;
  implementationStatus: MethodImplementationStatus;
  honestyTier: HonestyTier;
  honestyLabel: string;
  minObservations: number;
  requiresPolicyDate: boolean;
  requiresDonorPool: boolean;
  minDonors?: number;
  requiresInstrument: boolean;
  requiresCutoff: boolean;
  plainLanguageExplanation: string;
  assumptions: string[];
  threatsToValidity: string[];
};

export const METHOD_CATALOG: Record<EconometricMethodId, MethodCatalogDescriptor> = {
  descriptive_newey_west: {
    id: "descriptive_newey_west",
    label: "Interrupted Time Series / Pre-Post Trend Shift (Newey–West HAC SEs)",
    implementationStatus: "Working",
    honestyTier: "Descriptive",
    honestyLabel: "Descriptive",
    minObservations: 10,
    requiresPolicyDate: true,
    requiresDonorPool: false,
    requiresInstrument: false,
    requiresCutoff: false,
    plainLanguageExplanation:
      "Compares the outcome series before and after the policy date while controlling for a linear time trend, using Newey–West heteroskedasticity and autocorrelation consistent (HAC) standard errors. Never labeled quasi-experimental without an untreated comparison group.",
    assumptions: [
      "Weak stationarity of residual innovations",
      "HAC truncation lag captures serial correlation structure",
    ],
    threatsToValidity: [
      "Macroeconomic shocks coinciding with the policy date are not causally separated from the policy shift",
      "Nonlinear pre-existing secular trends can bias the post-policy level shift",
    ],
  },
  chow_break_test: {
    id: "chow_break_test",
    label: "Chow Structural Break Test at Policy Date",
    implementationStatus: "Working",
    honestyTier: "Descriptive",
    honestyLabel: "Descriptive",
    minObservations: 12,
    requiresPolicyDate: true,
    requiresDonorPool: false,
    requiresInstrument: false,
    requiresCutoff: false,
    plainLanguageExplanation:
      "Tests whether the intercept and slope of the outcome trajectory broke significantly at the known policy enactment date.",
    assumptions: [
      "Known break date corresponds to policy implementation",
      "Error variance is comparable across subsamples (or HAC-corrected)",
    ],
    threatsToValidity: [
      "Anticipation effects prior to enactment can blur the structural break date",
      "Concurrent macro shocks at the break date confound causal attribution",
    ],
  },
  bai_perron_break: {
    id: "bai_perron_break",
    label: "Bai–Perron Unknown Structural Break Detection",
    implementationStatus: "Working",
    honestyTier: "Descriptive",
    honestyLabel: "Descriptive",
    minObservations: 16,
    requiresPolicyDate: false,
    requiresDonorPool: false,
    requiresInstrument: false,
    requiresCutoff: false,
    plainLanguageExplanation:
      "Searches across all candidate interior dates (with 15% trimming) to identify the unknown structural break date that maximizes the sup-F statistic.",
    assumptions: [
      "Minimum regime length >= 15% of sample window",
      "No unit root in the error term",
    ],
    threatsToValidity: [
      "Detected break date may reflect a major macro crisis rather than the statutory instrument",
    ],
  },
  stationarity_adf_kpss: {
    id: "stationarity_adf_kpss",
    label: "Stationarity Diagnostics (ADF & KPSS)",
    implementationStatus: "Working",
    honestyTier: "Descriptive",
    honestyLabel: "Descriptive",
    minObservations: 12,
    requiresPolicyDate: false,
    requiresDonorPool: false,
    requiresInstrument: false,
    requiresCutoff: false,
    plainLanguageExplanation:
      "Tests for unit-root nonstationarity (Augmented Dickey–Fuller) and level/trend stationarity (KPSS) to guard against spurious regressions.",
    assumptions: [
      "Lag augmentation whitens serial correlation in Δy_t",
    ],
    threatsToValidity: [
      "Low power in small samples when root is near unity",
      "Unmodeled structural breaks can mimic a unit root",
    ],
  },
  arima_forecast_counterfactual: {
    id: "arima_forecast_counterfactual",
    label: "AR/ARIMA Pre-Policy Counterfactual Forecast",
    implementationStatus: "Working",
    honestyTier: "Associational",
    honestyLabel: "Associational",
    minObservations: 14,
    requiresPolicyDate: true,
    requiresDonorPool: false,
    requiresInstrument: false,
    requiresCutoff: false,
    plainLanguageExplanation:
      "Fits an autoregressive trend model strictly on the pre-policy window and projects the no-policy counterfactual path forward with forecast standard error bands, comparing actual post-policy realizations against the projection.",
    assumptions: [
      "Pre-policy autoregressive dynamics would have continued absent the policy intervention",
      "No contemporaneous macro regime shift in the post-policy window",
    ],
    threatsToValidity: [
      "Forecast uncertainty widens with horizon length",
      "Post-policy macro shocks enter the gap between actual and forecast",
    ],
  },
  local_projections_jorda: {
    id: "local_projections_jorda",
    label: "Jordà Local Projections Impulse Response (HAC CIs)",
    implementationStatus: "Working",
    honestyTier: "Associational",
    honestyLabel: "Associational",
    minObservations: 16,
    requiresPolicyDate: true,
    requiresDonorPool: false,
    requiresInstrument: false,
    requiresCutoff: false,
    plainLanguageExplanation:
      "Estimates direct horizon-by-horizon regressions y_{t+h} - y_{t-1} = α_h + β_h Shock_t + γ_h' X_{t-1} + ε_{t+h} for h = 0..H using Newey–West HAC standard errors.",
    assumptions: [
      "Shock variable is contemporaneously predetermined conditional on lagged controls",
      "Newey–West bandwidth (h+1) accounts for moving-average serial correlation of multistep forecast errors",
    ],
    threatsToValidity: [
      "Endogenous policy responses to anticipated output/price movements bias β_h if shock is not exogenous",
      "Sample size shrinks by h observations at longer horizons",
    ],
  },
  var_svar: {
    id: "var_svar",
    label: "Vector Autoregression (VAR / Cholesky SVAR)",
    implementationStatus: "Partial",
    honestyTier: "Associational",
    honestyLabel: "Associational",
    minObservations: 20,
    requiresPolicyDate: false,
    requiresDonorPool: false,
    requiresInstrument: false,
    requiresCutoff: false,
    plainLanguageExplanation:
      "Estimates a reduced-form multivariate autoregressive system with recursive (Cholesky) contemporaneous ordering stated explicitly in the specification.",
    assumptions: [
      "Recursive timing restriction (slow-moving variables ordered before fast-moving policy/financial variables)",
      "Invertibility and stability of the VAR companion matrix",
    ],
    threatsToValidity: [
      "Impulse responses can be sensitive to Cholesky variable ordering",
      "Omitted variables (price puzzle) can distort structural shocks",
    ],
  },
  granger_predictive: {
    id: "granger_predictive",
    label: "Granger Predictive Causality Test (Non-Causal)",
    implementationStatus: "Working",
    honestyTier: "Associational",
    honestyLabel: "Associational (Granger Predictive — Non-Causal)",
    minObservations: 16,
    requiresPolicyDate: false,
    requiresDonorPool: false,
    requiresInstrument: false,
    requiresCutoff: false,
    plainLanguageExplanation:
      "Tests whether lagged values of the predictor variable improve linear prediction of the outcome beyond the outcome's own lags. Strictly predictive, not structural causation.",
    assumptions: [
      "Stationarity of both series (or differenced transform)",
      "Linear lag structure",
    ],
    threatsToValidity: [
      "Forward-looking expectations invalidate causal interpretation of temporal precedence",
      "Common third-variable drivers create spurious Granger predictability",
    ],
  },
  event_study: {
    id: "event_study",
    label: "Dynamic Event Study (Leads & Lags with Pre-Trend F-Test)",
    implementationStatus: "Working",
    honestyTier: "Quasi-experimental",
    honestyLabel: "Quasi-experimental (Event Study)",
    minObservations: 14,
    requiresPolicyDate: true,
    requiresDonorPool: true,
    minDonors: 1,
    requiresInstrument: false,
    requiresCutoff: false,
    plainLanguageExplanation:
      "Estimates period-relative lead and lag coefficients around the policy enactment date (normalized to t = -1) relative to a comparison series and conducts a joint F-test that pre-policy lead coefficients equal zero. When run on a single series without a comparison group, it is automatically relabeled Descriptive.",
    assumptions: [
      "No anticipation prior to the reference period t = -1",
      "Parallel trends between treated and comparison series absent treatment (tested via pre-trend leads)",
    ],
    threatsToValidity: [
      "Significant pre-trends (pre-trend p < 0.05) indicate violation of the counterfactual trend assumption",
      "Single-series event studies without an untreated comparison group are relabeled Descriptive",
    ],
  },
  did_twfe: {
    id: "did_twfe",
    label: "Difference-in-Differences (Comparison-Series Differenced)",
    implementationStatus: "Working",
    honestyTier: "Quasi-experimental",
    honestyLabel: "Quasi-experimental (Difference-in-Differences)",
    minObservations: 12,
    requiresPolicyDate: true,
    requiresDonorPool: true,
    minDonors: 1,
    requiresInstrument: false,
    requiresCutoff: false,
    plainLanguageExplanation:
      "Compares pre-to-post outcome changes in the treated series against an untreated comparison series (Y_treated - Y_comparison) with a pre-trend parallelism test and Newey–West HAC standard errors. Relabeled Descriptive if no comparison series qualifies.",
    assumptions: [
      "Parallel pre-policy trends between treated and comparison series",
      "No spillover (SUTVA) from treated series onto comparison series",
    ],
    threatsToValidity: [
      "Differential shocks affecting treated vs. comparison series at the policy date",
      "If no qualified comparison series is available, degrades to a single-series Descriptive regression",
    ],
  },
  synthetic_control: {
    id: "synthetic_control",
    label: "Synthetic Control (Simplex-Weighted Donor Pool & Placebo Inference)",
    implementationStatus: "Working",
    honestyTier: "Quasi-experimental",
    honestyLabel: "Quasi-experimental (Synthetic Control)",
    minObservations: 12,
    requiresPolicyDate: true,
    requiresDonorPool: true,
    minDonors: 2,
    requiresInstrument: false,
    requiresCutoff: false,
    plainLanguageExplanation:
      "Constructs a convex combination of >= 2 untreated donor series (weights >= 0, sum = 1) that minimizes pre-intervention RMSPE, then measures the post-policy gap and conducts placebo inference. Relabeled Descriptive if fewer than 2 donor series qualify.",
    assumptions: [
      "Treated series' pre-policy trajectory lies within the convex hull of the donor pool",
      "Donor series are unaffected by the policy intervention",
    ],
    threatsToValidity: [
      "Poor pre-intervention fit (high pre-RMSPE) invalidates post-policy gap comparisons",
      "Interpolation bias if donor series differ markedly in scale",
    ],
  },
  rdd: {
    id: "rdd",
    label: "Local Linear Regression Discontinuity (RDD)",
    implementationStatus: "Not yet",
    honestyTier: "Quasi-experimental",
    honestyLabel: "Quasi-experimental (Regression Discontinuity)",
    minObservations: 20,
    requiresPolicyDate: false,
    requiresDonorPool: false,
    requiresInstrument: false,
    requiresCutoff: true,
    plainLanguageExplanation:
      "Estimates the discontinuous jump in the outcome at a known statutory threshold using local linear regression with triangular kernel weights (requires cross-sectional running-variable microdata).",
    assumptions: [
      "Continuity of potential outcomes across the cutoff",
      "No precise manipulation/sorting of the running variable around the threshold",
    ],
    threatsToValidity: [
      "Other policies sharing the exact same statutory threshold",
      "Sensitivity to bandwidth choice",
    ],
  },
  iv_2sls: {
    id: "iv_2sls",
    label: "Instrumental Variables / Two-Stage Least Squares (2SLS)",
    implementationStatus: "Partial",
    honestyTier: "Quasi-experimental",
    honestyLabel: "Quasi-experimental (IV/2SLS)",
    minObservations: 16,
    requiresPolicyDate: false,
    requiresDonorPool: false,
    requiresInstrument: true,
    requiresCutoff: false,
    plainLanguageExplanation:
      "Isolates exogenous variation in the endogenous policy/treatment variable using an excluded instrument series, reporting the first-stage F-statistic for weak-instrument diagnostics.",
    assumptions: [
      "Relevance: strong first-stage relationship (Stock–Yogo F > 10)",
      "Exclusion restriction: instrument affects outcome only through the endogenous treatment",
    ],
    threatsToValidity: [
      "Weak instruments (first-stage F < 10) bias 2SLS toward OLS and distort confidence intervals",
      "Direct channel from instrument to outcome violates exclusion restriction",
    ],
  },
  panel_fe_re: {
    id: "panel_fe_re",
    label: "Panel Fixed Effects with Cluster-Robust SEs",
    implementationStatus: "Not yet",
    honestyTier: "Associational",
    honestyLabel: "Associational",
    minObservations: 16,
    requiresPolicyDate: false,
    requiresDonorPool: true,
    minDonors: 2,
    requiresInstrument: false,
    requiresCutoff: false,
    plainLanguageExplanation:
      "Estimates within-unit panel regressions removing time-invariant unit heterogeneity, with cluster-robust standard errors (requires multi-unit panel dataset).",
    assumptions: [
      "Strict exogeneity of regressors conditional on unit fixed effects",
    ],
    threatsToValidity: [
      "Time-varying unobserved confounders within units",
      "Nickell bias in short panels with lagged dependent variables",
    ],
  },
};
