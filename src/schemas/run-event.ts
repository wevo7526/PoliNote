import { z } from "zod";

/**
 * Append-only domain event log (not LangSmith).
 * Prefix families: run.* agent.* llm.* mcp.* node.* edge.* critic.* span.*
 */
export const RunEventTypeSchema = z.enum([
  "run.created",
  "run.started",
  "run.paused",
  "run.resumed",
  "run.completed",
  "run.failed",
  "agent.turn_started",
  "agent.turn_completed",
  "llm.call",
  "mcp.tool_call",
  "mcp.tool_result",
  "node.created",
  "node.updated",
  "node.status_changed",
  "edge.created",
  "edge.removed",
  "critic.flag",
  "critic.allowlist_block",
  "span.opened",
  "span.closed",
  "scope.updated",
  "export.generated",
]);

export type RunEventType = z.infer<typeof RunEventTypeSchema>;

export const RunEventSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  type: RunEventTypeSchema,
  /** Wall-clock ISO timestamp for scrubber ordering. */
  ts: z.string().datetime(),
  agent: z.string().optional(),
  /** Optional parent span for nesting llm/mcp under agent turns. */
  spanId: z.string().optional(),
  parentSpanId: z.string().optional(),
  /**
   * Domain payload. Never store secrets (API keys, tokens).
   * Shape varies by type; kept loosely typed at the contract boundary.
   */
  payload: z.record(z.string(), z.unknown()).default({}),
});

export type RunEvent = z.infer<typeof RunEventSchema>;

export const RunStatusSchema = z.enum([
  "draft",
  "ready",
  "running",
  "paused",
  "completed",
  "failed",
]);

export type RunStatus = z.infer<typeof RunStatusSchema>;

export const DigressionRunSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: RunStatusSchema,
  scopeContractId: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type DigressionRun = z.infer<typeof DigressionRunSchema>;
