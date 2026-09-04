-- Initial schema for Policy Digression Workbench
-- Mirrors src/db/schema.ts (Drizzle). Apply via `npm run db:migrate` once DATABASE_URL is set.

CREATE TYPE node_kind AS ENUM (
  'claim', 'mechanism', 'constraint', 'evidence',
  'counterfactual', 'incidence', 'uncertainty', 'fork'
);

CREATE TYPE node_status AS ENUM (
  'proposed', 'contested', 'supported', 'rejected', 'pruned'
);

CREATE TYPE confidence_band AS ENUM ('low', 'medium', 'high', 'unknown');

CREATE TYPE edge_kind AS ENUM (
  'supports', 'attacks', 'depends_on', 'elaborates', 'alternatives', 'causal'
);

CREATE TYPE run_status AS ENUM (
  'draft', 'ready', 'running', 'paused', 'completed', 'failed'
);

CREATE TABLE scope_contracts (
  id text PRIMARY KEY,
  question text NOT NULL,
  jurisdiction text NOT NULL,
  horizon text NOT NULL,
  objective text NOT NULL,
  instrument text NOT NULL,
  target text NOT NULL,
  identification_strategy text NOT NULL,
  distributional_cut text NOT NULL,
  baseline text NOT NULL,
  allowed_methods jsonb NOT NULL,
  forbidden_moves jsonb NOT NULL DEFAULT '[]'::jsonb,
  mcp_allowlist jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE digression_runs (
  id text PRIMARY KEY,
  title text NOT NULL,
  status run_status NOT NULL DEFAULT 'draft',
  scope_contract_id text NOT NULL REFERENCES scope_contracts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE digression_nodes (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES digression_runs(id) ON DELETE CASCADE,
  kind node_kind NOT NULL,
  status node_status NOT NULL DEFAULT 'proposed',
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  confidence confidence_band NOT NULL DEFAULT 'unknown',
  agent text,
  provenance jsonb NOT NULL DEFAULT '[]'::jsonb,
  position_x numeric(12, 2) NOT NULL,
  position_y numeric(12, 2) NOT NULL,
  evidence_span_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  cost_usd numeric(12, 6),
  latency_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE digression_edges (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES digression_runs(id) ON DELETE CASCADE,
  source_id text NOT NULL REFERENCES digression_nodes(id) ON DELETE CASCADE,
  target_id text NOT NULL REFERENCES digression_nodes(id) ON DELETE CASCADE,
  kind edge_kind NOT NULL,
  label text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE run_events (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES digression_runs(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  type text NOT NULL,
  ts timestamptz NOT NULL DEFAULT now(),
  agent text,
  span_id text,
  parent_span_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX run_events_run_id_seq_idx ON run_events (run_id, seq);

CREATE TABLE graph_checkpoints (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES digression_runs(id) ON DELETE CASCADE,
  thread_id text NOT NULL,
  checkpoint_ns text NOT NULL DEFAULT '',
  checkpoint_id text NOT NULL,
  parent_checkpoint_id text,
  checkpoint jsonb NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE project_settings (
  id text PRIMARY KEY DEFAULT 'default',
  mcp_allowlist jsonb NOT NULL,
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
