import { z } from "zod";
import type {
  EconometricEstimate,
  HonestyTier,
  RobustnessBundle,
} from "@/lib/economics/schemas";

export const DigressionNodeKindSchema = z.enum([
  "claim",
  "mechanism",
  "constraint",
  "evidence",
  "counterfactual",
  "incidence",
  "uncertainty",
  "fork",
]);

export type DigressionNodeKind = z.infer<typeof DigressionNodeKindSchema>;

/**
 * Claim & node status lifecycle:
 * proposed -> data_attached -> tested -> supported / contradicted / inconclusive
 * (plus unverifiable when a live data source fails, contested, rejected, pruned).
 * Set ONLY by deterministic code rules on the estimate.
 */
export const DigressionNodeStatusSchema = z.enum([
  "proposed",
  "data_attached",
  "tested",
  "supported",
  "contradicted",
  "inconclusive",
  "unverifiable",
  "contested",
  "rejected",
  "pruned",
]);

export type DigressionNodeStatus = z.infer<typeof DigressionNodeStatusSchema>;

export const USER_NODE_STATUSES = [
  "proposed",
  "contested",
  "pruned",
] as const;
export type UserNodeStatus = (typeof USER_NODE_STATUSES)[number];

export function isUserNodeStatus(value: string): value is UserNodeStatus {
  return (USER_NODE_STATUSES as readonly string[]).includes(value);
}

export const ConfidenceBandSchema = z.enum([
  "low",
  "medium",
  "high",
  "unknown",
]);

export type ConfidenceBand = z.infer<typeof ConfidenceBandSchema>;

export const ProvenanceChipSchema = z.object({
  source: z.enum([
    "econ-series",
    "policy-docs",
    "literature",
    "workspace",
    "trace",
    "agent",
    "user",
    "web",
  ]),
  label: z.string().min(1),
  /** Hashed MCP / event span id when evidence-backed. */
  spanId: z.string().optional(),
  url: z.string().url().optional(),
  seriesId: z.string().optional(),
  seriesTitle: z.string().optional(),
  units: z.string().optional(),
  vintage: z.string().optional(),
  resultHash: z.string().optional(),
  seriesPoints: z
    .array(
      z.object({
        date: z.string(),
        value: z.number(),
      }),
    )
    .optional(),
});

export type ProvenanceChip = z.infer<typeof ProvenanceChipSchema>;

export const DigressionNodeSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  kind: DigressionNodeKindSchema,
  status: DigressionNodeStatusSchema,
  title: z.string().min(1),
  body: z.string().default(""),
  confidence: ConfidenceBandSchema.default("unknown"),
  honestyLabel: z.string().optional(),
  estimateId: z.string().optional(),
  hypothesizedDirection: z.enum(["positive", "negative", "ambiguous"]).optional(),
  statusReason: z.string().optional(),
  agent: z.string().optional(),
  provenance: z.array(ProvenanceChipSchema).default([]),
  /** Canvas layout (px). */
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  /** Linked MCP evidence span ids. */
  evidenceSpanIds: z.array(z.string()).default([]),
  costUsd: z.number().nonnegative().optional(),
  latencyMs: z.number().int().nonnegative().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type DigressionNode = z.infer<typeof DigressionNodeSchema>;

export const DigressionEdgeKindSchema = z.enum([
  "supports",
  "attacks",
  "depends_on",
  "elaborates",
  "alternatives",
  "causal",
]);

export type DigressionEdgeKind = z.infer<typeof DigressionEdgeKindSchema>;

export const DigressionEdgeSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  sourceId: z.string().min(1),
  targetId: z.string().min(1),
  kind: DigressionEdgeKindSchema,
  label: z.string().optional(),
  createdAt: z.string().datetime(),
});

export type DigressionEdge = z.infer<typeof DigressionEdgeSchema>;

export const DigressionGraphSchema = z.object({
  runId: z.string().min(1),
  nodes: z.array(DigressionNodeSchema),
  edges: z.array(DigressionEdgeSchema),
});

export type DigressionGraph = z.infer<typeof DigressionGraphSchema>;

/**
 * Legacy helper: checks whether at least one evidence span is present.
 * Note: Under the econometric lifecycle, `attachSpan` ONLY moves a node to `data_attached`,
 * never `supported`. Only `evaluateClaimStatusFromEstimate` can set `supported`.
 */
export function canMarkSupported(
  node: Pick<DigressionNode, "evidenceSpanIds" | "estimateId">,
): boolean {
  return node.evidenceSpanIds.length >= 1 && Boolean(node.estimateId);
}

/**
 * Deterministic code rule that evaluates a claim's status and confidence from
 * the computed econometric estimate, robustness pass rate, pre-trend test,
 * and unresolved Skeptic objections.
 */
export function evaluateClaimStatusFromEstimate(input: {
  estimate: EconometricEstimate | null;
  robustness: RobustnessBundle | null;
  hypothesizedDirection?: "positive" | "negative" | "ambiguous";
  unresolvedSkepticObjections?: number;
  dataUnavailable?: boolean;
  dataUnavailableReason?: string;
}): {
  status: DigressionNodeStatus;
  confidence: ConfidenceBand;
  honestyLabel: string;
  reason: string;
} {
  if (input.dataUnavailable || !input.estimate) {
    return {
      status: "unverifiable",
      confidence: "unknown",
      honestyLabel: "Descriptive",
      reason:
        input.dataUnavailableReason ||
        "Data unavailable: no live econometric estimate could be computed for this claim.",
    };
  }

  const est = input.estimate;
  const rob = input.robustness;
  const ciExcludesZero =
    (est.ciLower > 0 && est.ciUpper > 0) ||
    (est.ciLower < 0 && est.ciUpper < 0);
  const preTrendPassed =
    est.diagnostics.preTrendPValue === undefined ||
    est.diagnostics.preTrendPValue >= 0.05;
  const robustnessPassRate = rob ? rob.passRate : 0.5;
  const robustnessPassed = robustnessPassRate >= 0.6 && !(rob?.signFlipped ?? false);

  const dir = input.hypothesizedDirection ?? "ambiguous";
  const sign = Math.sign(est.pointEstimate);
  const directionMatches =
    dir === "ambiguous"
      ? sign !== 0
      : dir === "positive"
        ? sign > 0
        : sign < 0;
  const directionOpposite =
    dir !== "ambiguous" &&
    sign !== 0 &&
    ((dir === "positive" && sign < 0) || (dir === "negative" && sign > 0));

  let status: DigressionNodeStatus;
  let reason: string;

  if (ciExcludesZero && directionOpposite && robustnessPassed) {
    status = "contradicted";
    reason = `Estimate β = ${est.pointEstimate} (95% CI [${est.ciLower}, ${est.ciUpper}], p = ${est.pValue}) has the opposite sign of the hypothesized ${dir} effect and excludes zero.`;
  } else if (ciExcludesZero && directionMatches && preTrendPassed && robustnessPassed) {
    status = "supported";
    reason = `Estimate β = ${est.pointEstimate} (95% CI [${est.ciLower}, ${est.ciUpper}], p = ${est.pValue}) excludes zero, passes pre-trend check, and holds across ${(robustnessPassRate * 100).toFixed(0)}% of robustness specs.`;
  } else {
    status = "inconclusive";
    const reasons: string[] = [];
    if (!ciExcludesZero) {
      reasons.push(
        `95% CI [${est.ciLower}, ${est.ciUpper}] includes zero (p = ${est.pValue})`,
      );
    }
    if (!preTrendPassed) {
      reasons.push(
        `pre-trend test flagged (p = ${est.diagnostics.preTrendPValue})`,
      );
    }
    if (!robustnessPassed) {
      reasons.push(
        `robustness pass rate is ${(robustnessPassRate * 100).toFixed(0)}%${rob?.signFlipped ? " with sign flip across specs" : ""}`,
      );
    }
    reason = `Tested (${est.methodLabel}), but inconclusive: ${reasons.join("; ") || "insufficient statistical precision"}.`;
  }

  const confidence = computeDeterministicConfidence({
    honestyTier: est.honestyTier,
    robustnessPassRate,
    preTrendPassed,
    ciExcludesZero,
    unresolvedSkepticObjections: input.unresolvedSkepticObjections ?? 0,
  });

  return {
    status,
    confidence,
    honestyLabel: est.honestyLabel,
    reason,
  };
}

export function computeDeterministicConfidence(input: {
  honestyTier: HonestyTier;
  robustnessPassRate: number;
  preTrendPassed: boolean;
  ciExcludesZero: boolean;
  unresolvedSkepticObjections: number;
}): ConfidenceBand {
  let score = 0;
  if (input.honestyTier === "Quasi-experimental") score += 2;
  else if (input.honestyTier === "Associational" || input.honestyTier === "Literature estimate") score += 1;

  if (input.robustnessPassRate >= 0.8) score += 2;
  else if (input.robustnessPassRate >= 0.6) score += 1;

  if (input.preTrendPassed) score += 1;
  if (!input.ciExcludesZero) score -= 1;
  score -= Math.min(2, input.unresolvedSkepticObjections);

  if (score >= 4) return "high";
  if (score >= 2) return "medium";
  return "low";
}
