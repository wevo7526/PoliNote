import { z } from "zod";

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
 * Evidence / support status.
 * Hard rule: no node → supported without ≥1 MCP evidence span.
 */
export const DigressionNodeStatusSchema = z.enum([
  "proposed",
  "contested",
  "supported",
  "rejected",
  "pruned",
]);

export type DigressionNodeStatus = z.infer<typeof DigressionNodeStatusSchema>;

export const USER_NODE_STATUSES = ["proposed", "contested", "pruned"] as const;
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
  agent: z.string().optional(),
  provenance: z.array(ProvenanceChipSchema).default([]),
  /** Canvas layout (px). */
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  /** Linked MCP evidence span ids — required length ≥1 for status=supported. */
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

/** Product rule: supported nodes need at least one MCP evidence span. */
export function canMarkSupported(node: Pick<DigressionNode, "evidenceSpanIds">): boolean {
  return node.evidenceSpanIds.length >= 1;
}
