import {
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const nodeKindEnum = pgEnum("node_kind", [
  "claim",
  "mechanism",
  "constraint",
  "evidence",
  "counterfactual",
  "incidence",
  "uncertainty",
  "fork",
]);

export const nodeStatusEnum = pgEnum("node_status", [
  "proposed",
  "contested",
  "supported",
  "rejected",
  "pruned",
]);

export const confidenceBandEnum = pgEnum("confidence_band", [
  "low",
  "medium",
  "high",
  "unknown",
]);

export const edgeKindEnum = pgEnum("edge_kind", [
  "supports",
  "attacks",
  "depends_on",
  "elaborates",
  "alternatives",
  "causal",
]);

export const runStatusEnum = pgEnum("run_status", [
  "draft",
  "ready",
  "running",
  "paused",
  "completed",
  "failed",
]);

export const scopeContracts = pgTable("scope_contracts", {
  id: text("id").primaryKey(),
  question: text("question").notNull(),
  jurisdiction: text("jurisdiction").notNull(),
  horizon: text("horizon").notNull(),
  objective: text("objective").notNull(),
  instrument: text("instrument").notNull(),
  target: text("target").notNull(),
  identificationStrategy: text("identification_strategy").notNull(),
  distributionalCut: text("distributional_cut").notNull(),
  baseline: text("baseline").notNull(),
  allowedMethods: jsonb("allowed_methods").$type<string[]>().notNull(),
  forbiddenMoves: jsonb("forbidden_moves").$type<string[]>().notNull().default([]),
  mcpAllowlist: jsonb("mcp_allowlist")
    .$type<Record<string, boolean>>()
    .notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const digressionRuns = pgTable("digression_runs", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  status: runStatusEnum("status").notNull().default("draft"),
  scopeContractId: text("scope_contract_id")
    .notNull()
    .references(() => scopeContracts.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const digressionNodes = pgTable("digression_nodes", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => digressionRuns.id, { onDelete: "cascade" }),
  kind: nodeKindEnum("kind").notNull(),
  status: nodeStatusEnum("status").notNull().default("proposed"),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  confidence: confidenceBandEnum("confidence").notNull().default("unknown"),
  agent: text("agent"),
  provenance: jsonb("provenance").$type<unknown[]>().notNull().default([]),
  positionX: numeric("position_x", { precision: 12, scale: 2 }).notNull(),
  positionY: numeric("position_y", { precision: 12, scale: 2 }).notNull(),
  evidenceSpanIds: jsonb("evidence_span_ids").$type<string[]>().notNull().default([]),
  costUsd: numeric("cost_usd", { precision: 12, scale: 6 }),
  latencyMs: integer("latency_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const digressionEdges = pgTable("digression_edges", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => digressionRuns.id, { onDelete: "cascade" }),
  sourceId: text("source_id")
    .notNull()
    .references(() => digressionNodes.id, { onDelete: "cascade" }),
  targetId: text("target_id")
    .notNull()
    .references(() => digressionNodes.id, { onDelete: "cascade" }),
  kind: edgeKindEnum("kind").notNull(),
  label: text("label"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Append-only event log. seq is unique per run for SSE resume + scrubber replay.
 * payload must never contain secrets.
 */
export const runEvents = pgTable(
  "run_events",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => digressionRuns.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    agent: text("agent"),
    spanId: text("span_id"),
    parentSpanId: text("parent_span_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [uniqueIndex("run_events_run_id_seq_idx").on(table.runId, table.seq)],
);

/** LangGraph checkpoint store (blob) — filled when crew lands. */
export const graphCheckpoints = pgTable("graph_checkpoints", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => digressionRuns.id, { onDelete: "cascade" }),
  threadId: text("thread_id").notNull(),
  checkpointNs: text("checkpoint_ns").notNull().default(""),
  checkpointId: text("checkpoint_id").notNull(),
  parentCheckpointId: text("parent_checkpoint_id"),
  /** Opaque LangGraph checkpoint JSON. */
  checkpoint: jsonb("checkpoint").$type<Record<string, unknown>>().notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projectSettings = pgTable("project_settings", {
  id: text("id").primaryKey().default("default"),
  mcpAllowlist: jsonb("mcp_allowlist")
    .$type<Record<string, boolean>>()
    .notNull(),
  /** Feature flags for later phases. */
  features: jsonb("features")
    .$type<Record<string, boolean>>()
    .notNull()
    .default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
