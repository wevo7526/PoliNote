import type { DuckDBConnection } from "@duckdb/node-api";
import { asJson, mutateUserDb, queryRows, withUserDb } from "@/lib/db/user-store";
import type { RunEvent, RunEventType } from "@/schemas/run-event";

const ENSURE = `
CREATE TABLE IF NOT EXISTS events (
  id VARCHAR PRIMARY KEY,
  run_id VARCHAR NOT NULL,
  seq INTEGER NOT NULL,
  type VARCHAR NOT NULL,
  ts VARCHAR NOT NULL,
  agent VARCHAR,
  span_id VARCHAR,
  parent_span_id VARCHAR,
  payload JSON NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS events_run_seq ON events (run_id, seq);
`;

export async function ensureEventsTable(connection: DuckDBConnection): Promise<void> {
  await connection.run(ENSURE);
}

export type RunEventDraft = {
  type: RunEventType;
  payload?: Record<string, unknown>;
  agent?: string;
  spanId?: string;
  parentSpanId?: string;
};

function rowToEvent(row: {
  id: string;
  run_id: string;
  seq: number;
  type: string;
  ts: string;
  agent: string | null;
  span_id: string | null;
  parent_span_id: string | null;
  payload: unknown;
}): RunEvent {
  return {
    id: row.id,
    runId: row.run_id,
    seq: Number(row.seq),
    type: row.type as RunEvent["type"],
    ts: row.ts,
    agent: row.agent ?? undefined,
    spanId: row.span_id ?? undefined,
    parentSpanId: row.parent_span_id ?? undefined,
    payload: asJson<Record<string, unknown>>(row.payload) ?? {},
  };
}

export async function listEvents(
  userId: string,
  runId: string,
  afterSeq = -1,
): Promise<RunEvent[]> {
  return withUserDb(userId, async (connection) => {
    await connection.run(ENSURE);
    const rows = await queryRows<{
      id: string;
      run_id: string;
      seq: number;
      type: string;
      ts: string;
      agent: string | null;
      span_id: string | null;
      parent_span_id: string | null;
      payload: unknown;
    }>(
      connection,
      `SELECT id, run_id, seq, type, ts, agent, span_id, parent_span_id, payload
       FROM events
       WHERE run_id = $run_id AND seq > $after
       ORDER BY seq ASC`,
      { run_id: runId, after: afterSeq },
    );
    return rows.map(rowToEvent);
  });
}

export async function appendRunEvent(
  userId: string,
  runId: string,
  draft: RunEventDraft,
): Promise<RunEvent> {
  const ts = new Date().toISOString();
  return mutateUserDb(userId, async (connection) => {
    await connection.run(ENSURE);
    const seqRows = await queryRows<{ next: number }>(
      connection,
      `SELECT COALESCE(MAX(seq), -1) + 1 AS next FROM events WHERE run_id = $run_id`,
      { run_id: runId },
    );
    const event: RunEvent = {
      id: crypto.randomUUID(),
      runId,
      seq: Number(seqRows[0]?.next ?? 0),
      type: draft.type,
      ts,
      agent: draft.agent,
      spanId: draft.spanId,
      parentSpanId: draft.parentSpanId,
      payload: draft.payload ?? {},
    };
    await connection.run(
      `INSERT INTO events
        (id, run_id, seq, type, ts, agent, span_id, parent_span_id, payload)
       VALUES
        ($id, $run_id, $seq, $type, $ts, $agent, $span_id, $parent_span_id, $payload)`,
      {
        id: event.id,
        run_id: runId,
        seq: event.seq,
        type: event.type,
        ts: event.ts,
        agent: event.agent ?? null,
        span_id: event.spanId ?? null,
        parent_span_id: event.parentSpanId ?? null,
        payload: JSON.stringify(event.payload),
      },
    );
    return event;
  });
}
