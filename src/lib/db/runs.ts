import { asJson, queryRows, withUserDb } from "@/lib/db/user-store";
import type { RunSnapshot, RunSummary } from "@/lib/platform-types";
import type { NodeAnalysis } from "@/schemas/analysis";
import type { DigressionEdge, DigressionNode } from "@/schemas/digression";
import type { ScopeContract } from "@/schemas/scope-contract";
import type { ThreadItem } from "@/components/studio/thread-types";

function nowIso(): string {
  return new Date().toISOString();
}

export async function listRuns(userId: string): Promise<RunSummary[]> {
  return withUserDb(userId, async (connection) => {
    const rows = await queryRows<{
      id: string;
      title: string;
      status: RunSummary["status"];
      created_at: string;
      updated_at: string;
    }>(
      connection,
      `SELECT id, title, status, created_at, updated_at
       FROM runs
       ORDER BY updated_at DESC`,
    );
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  });
}

export async function createRun(userId: string): Promise<RunSummary> {
  const ts = nowIso();
  const run: RunSummary = {
    id: crypto.randomUUID(),
    title: "Untitled run",
    status: "draft",
    createdAt: ts,
    updatedAt: ts,
  };
  await withUserDb(userId, async (connection) => {
    await connection.run(
      `INSERT INTO runs (id, title, status, created_at, updated_at)
       VALUES ($id, $title, $status, $created_at, $updated_at)`,
      {
        id: run.id,
        title: run.title,
        status: run.status,
        created_at: run.createdAt,
        updated_at: run.updatedAt,
      },
    );
  });
  return run;
}

export async function getRun(
  userId: string,
  runId: string,
): Promise<RunSnapshot | null> {
  return withUserDb(userId, async (connection) => {
    const runs = await queryRows<{
      id: string;
      title: string;
      status: RunSummary["status"];
      created_at: string;
      updated_at: string;
    }>(connection, `SELECT * FROM runs WHERE id = $id`, { id: runId });
    const row = runs[0];
    if (!row) return null;

    const messages = await queryRows<{ payload: unknown }>(
      connection,
      `SELECT payload FROM messages WHERE run_id = $id ORDER BY seq ASC`,
      { id: runId },
    );
    const nodeRows = await queryRows<{ data: unknown }>(
      connection,
      `SELECT data FROM nodes WHERE run_id = $id`,
      { id: runId },
    );
    const edgeRows = await queryRows<{ data: unknown }>(
      connection,
      `SELECT data FROM edges WHERE run_id = $id`,
      { id: runId },
    );
    const scopeRows = await queryRows<{ data: unknown }>(
      connection,
      `SELECT data FROM scopes WHERE run_id = $id`,
      { id: runId },
    );
    const analysisRows = await queryRows<{
      node_id: string;
      run_id: string;
      title: string;
      body: string;
      citations: unknown;
    }>(
      connection,
      `SELECT node_id, run_id, title, body, citations FROM analyses WHERE run_id = $id`,
      { id: runId },
    );

    const analyses: Record<string, NodeAnalysis> = {};
    for (const analysis of analysisRows) {
      analyses[analysis.node_id] = {
        nodeId: analysis.node_id,
        runId: analysis.run_id,
        title: analysis.title,
        body: analysis.body,
        citations: asJson(analysis.citations),
      };
    }

    return {
      run: {
        id: row.id,
        title: row.title,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
      items: messages.map((message) => asJson<ThreadItem>(message.payload)),
      nodes: nodeRows.map((node) => asJson<DigressionNode>(node.data)),
      edges: edgeRows.map((edge) => asJson<DigressionEdge>(edge.data)),
      scope: scopeRows[0] ? asJson<ScopeContract>(scopeRows[0].data) : null,
      analyses,
    };
  });
}

export async function assertRunExists(
  userId: string,
  runId: string,
): Promise<boolean> {
  return withUserDb(userId, async (connection) => {
    const rows = await queryRows<{ id: string }>(
      connection,
      `SELECT id FROM runs WHERE id = $id`,
      { id: runId },
    );
    return rows.length > 0;
  });
}

export async function persistTurn(
  userId: string,
  runId: string,
  input: {
    title: string;
    status: RunSummary["status"];
    items: ThreadItem[];
    nodes: DigressionNode[];
    edges: DigressionEdge[];
    scope: ScopeContract | null;
    analyses: NodeAnalysis[];
  },
): Promise<void> {
  const ts = nowIso();
  await withUserDb(userId, async (connection) => {
    await connection.run(
      `UPDATE runs SET title = $title, status = $status, updated_at = $updated_at WHERE id = $id`,
      { title: input.title, status: input.status, updated_at: ts, id: runId },
    );
    await connection.run(`DELETE FROM messages WHERE run_id = $id`, { id: runId });
    await connection.run(`DELETE FROM nodes WHERE run_id = $id`, { id: runId });
    await connection.run(`DELETE FROM edges WHERE run_id = $id`, { id: runId });
    await connection.run(`DELETE FROM analyses WHERE run_id = $id`, { id: runId });

    for (const [index, item] of input.items.entries()) {
      await connection.run(
        `INSERT INTO messages (id, run_id, seq, kind, payload, created_at)
         VALUES ($id, $run_id, $seq, $kind, $payload, $created_at)`,
        {
          id: item.id,
          run_id: runId,
          seq: index,
          kind: item.kind,
          payload: JSON.stringify(item),
          created_at: ts,
        },
      );
    }
    for (const node of input.nodes) {
      await connection.run(
        `INSERT INTO nodes (id, run_id, data) VALUES ($id, $run_id, $data)`,
        { id: node.id, run_id: runId, data: JSON.stringify(node) },
      );
    }
    for (const edge of input.edges) {
      await connection.run(
        `INSERT INTO edges (id, run_id, data) VALUES ($id, $run_id, $data)`,
        { id: edge.id, run_id: runId, data: JSON.stringify(edge) },
      );
    }
    if (input.scope) {
      await connection.run(
        `INSERT OR REPLACE INTO scopes (run_id, data) VALUES ($run_id, $data)`,
        { run_id: runId, data: JSON.stringify(input.scope) },
      );
    }
    for (const analysis of input.analyses) {
      await connection.run(
        `INSERT INTO analyses (node_id, run_id, title, body, citations)
         VALUES ($node_id, $run_id, $title, $body, $citations)`,
        {
          node_id: analysis.nodeId,
          run_id: runId,
          title: analysis.title,
          body: analysis.body,
          citations: JSON.stringify(analysis.citations),
        },
      );
    }
  });
}

export async function persistScope(
  userId: string,
  runId: string,
  scope: ScopeContract,
): Promise<RunSnapshot | null> {
  const ts = nowIso();
  await withUserDb(userId, async (connection) => {
    await connection.run(
      `INSERT OR REPLACE INTO scopes (run_id, data) VALUES ($run_id, $data)`,
      { run_id: runId, data: JSON.stringify({ ...scope, updatedAt: ts }) },
    );
    await connection.run(
      `UPDATE runs SET updated_at = $updated_at WHERE id = $id`,
      { updated_at: ts, id: runId },
    );
  });
  return getRun(userId, runId);
}
