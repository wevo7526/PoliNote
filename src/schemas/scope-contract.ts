import { z } from "zod";

/** Methods agents may use when building digression nodes. */
export const AllowedMethodSchema = z.enum([
  "literature",
  "time_series",
  "legal_text",
  "macro",
  "incidence",
  "counterfactual",
  "expert_judgment",
]);

export type AllowedMethod = z.infer<typeof AllowedMethodSchema>;

/**
 * Scope Contract — filled before generation. Blocks runs until instrument,
 * target, identification strategy, and horizon are present.
 */
export const ScopeContractSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  jurisdiction: z.string().min(1),
  horizon: z.string().min(1),
  objective: z.string().min(1),
  /** Policy instrument under analysis (e.g. "25% ad valorem EV tariff"). */
  instrument: z.string().min(1),
  /** Outcome / population target (e.g. "US EV retail prices + employment"). */
  target: z.string().min(1),
  /** How agents identify causal / comparative effects. */
  identificationStrategy: z.string().min(1),
  distributionalCut: z.string().min(1),
  baseline: z.string().min(1),
  allowedMethods: z.array(AllowedMethodSchema).min(1),
  forbiddenMoves: z.array(z.string()).default([]),
  /** MCP servers enabled for this project/run. Off servers cannot support claims. */
  mcpAllowlist: z
    .object({
      "econ-series": z.boolean().default(true),
      "policy-docs": z.boolean().default(true),
      literature: z.boolean().default(true),
      workspace: z.boolean().default(true),
      trace: z.boolean().default(true),
    })
    .default({
      "econ-series": true,
      "policy-docs": true,
      literature: true,
      workspace: true,
      trace: true,
    }),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ScopeContract = z.infer<typeof ScopeContractSchema>;

/** Fields that must be non-empty before agents may generate. */
export const SCOPE_REQUIRED_FIELDS = [
  "instrument",
  "target",
  "identificationStrategy",
  "horizon",
] as const;

export type ScopeRequiredField = (typeof SCOPE_REQUIRED_FIELDS)[number];

export function isScopeReady(
  contract: Pick<ScopeContract, ScopeRequiredField>,
): boolean {
  return SCOPE_REQUIRED_FIELDS.every((field) => {
    const value = contract[field];
    return typeof value === "string" && value.trim().length > 0;
  });
}
