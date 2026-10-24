import { z } from "zod";
import { EconometricMethodIdSchema } from "@/lib/economics/schemas";

export const ScoperOutputSchema = z.object({
  runTitle: z.string().min(1).max(100),
  policyDate: z.string().nullable(),
  unitOfAnalysis: z.string().min(1),
  geography: z.string().min(1),
  hypothesizedDirection: z.enum(["positive", "negative", "ambiguous"]),
  treatmentCandidates: z.array(z.string()).default([]),
  controlCandidates: z.array(z.string()).default([]),
  scope: z.object({
    jurisdiction: z.string().min(1),
    horizon: z.string().min(1),
    objective: z.string().min(1),
    instrument: z.string().min(1),
    target: z.string().min(1),
    identificationStrategy: z.string().min(1),
    distributionalCut: z.string().min(1),
    baseline: z.string().min(1),
  }),
});

export type ScoperOutput = z.infer<typeof ScoperOutputSchema>;

export const DataScoutOutputSchema = z.object({
  searchQueries: z.array(z.string()).min(1),
  selectedSeriesIds: z.array(z.string()),
  selectionRationale: z.string(),
  rejectedSeriesSummary: z.array(
    z.object({
      seriesId: z.string(),
      reason: z.string(),
    }),
  ),
});

export type DataScoutOutput = z.infer<typeof DataScoutOutputSchema>;

export const IdentificationStrategistOutputSchema = z.object({
  selectedMethod: EconometricMethodIdSchema,
  secondaryMethod: EconometricMethodIdSchema.optional(),
  identificationAssumptions: z.array(z.string()).min(1),
  threatsToValidity: z.array(z.string()).min(1),
  confoundersInWindow: z.array(z.string()).default([]),
});

export type IdentificationStrategistOutput = z.infer<
  typeof IdentificationStrategistOutputSchema
>;

export const EconometricianSpecOutputSchema = z.object({
  method: EconometricMethodIdSchema,
  outcomeSeriesId: z.string().min(1),
  controlSeriesIds: z.array(z.string()).default([]),
  policyDate: z.string().nullable(),
  transform: z.enum(["lin", "log", "diff"]).default("lin"),
  hacLags: z.number().int().min(1).max(16).default(4),
  lpHorizons: z.number().int().min(2).max(16).default(8),
});

export type EconometricianSpecOutput = z.infer<
  typeof EconometricianSpecOutputSchema
>;

export const SkepticFlipConditionSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  forkParameter: z.enum([
    "method",
    "window",
    "series",
    "transform",
    "placebo_date",
  ]),
  proposedValue: z.string(),
});

export type SkepticFlipCondition = z.infer<typeof SkepticFlipConditionSchema>;

export const SkepticOutputSchema = z.object({
  namedConfounders: z.array(z.string()),
  reverseCausalityRisk: z.string(),
  specificationFragility: z.string(),
  externalValidityLimits: z.string(),
  unresolvedObjectionsCount: z.number().int().nonnegative(),
  whatWouldChangeMyMind: z.array(SkepticFlipConditionSchema).min(1),
});

export type SkepticOutput = z.infer<typeof SkepticOutputSchema>;
