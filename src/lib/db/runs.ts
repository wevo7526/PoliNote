import { appendRunEvent, ensureEventsTable, listEvents } from "@/lib/db/events";
import { DEFAULT_PROJECT_ID, ensureDefaultProject } from "@/lib/db/projects";
import { asJson, mutateUserDb, queryRows, withUserDb } from "@/lib/db/user-store";
import type { RunDraft, RunSnapshot, RunSummary } from "@/lib/platform-types";
import type { NodeAnalysis } from "@/schemas/analysis";
import type {
  DigressionEdge,
  DigressionNode,
  DigressionNodeKind,
  UserNodeStatus,
} from "@/schemas/digression";
import type { RunEvent } from "@/schemas/run-event";
import type { ScopeContract } from "@/schemas/scope-contract";
import type { ThreadItem } from "@/components/studio/thread-types";

function nowIso(): string {
  return new Date().toISOString();
}

export async function listRuns(userId: string): Promise<RunSummary[]> {
  const defaultProject = await ensureDefaultProject(userId);
  return withUserDb(userId, async (connection) => {
    const rows = await queryRows<{
      id: string;
      project_id: string | null;
      title: string;
      status: RunSummary["status"];
      created_at: string;
      updated_at: string;
    }>(
      connection,
      `SELECT id, project_id, title, status, created_at, updated_at
       FROM runs
       ORDER BY updated_at DESC`,
    );
    return rows.map((row) => ({
      id: row.id,
      projectId: row.project_id || defaultProject.id || DEFAULT_PROJECT_ID,
      title: row.title,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  });
}

export async function createRun(
  userId: string,
  options?: { id?: string; projectId?: string; title?: string },
): Promise<RunSummary> {
  const defaultProject = await ensureDefaultProject(userId);
  const projectId = options?.projectId?.trim() || defaultProject.id;
  const ts = nowIso();
  const candidateId = options?.id?.trim() ?? "";
  const run: RunSummary = {
    id:
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        candidateId,
      )
        ? candidateId
        : crypto.randomUUID(),
    projectId,
    title: options?.title?.trim() || "Untitled run",
    status: "draft",
    createdAt: ts,
    updatedAt: ts,
  };
  await mutateUserDb(userId, async (connection) => {
    await connection.run(
      `INSERT OR IGNORE INTO runs (id, project_id, title, status, created_at, updated_at)
       VALUES ($id, $project_id, $title, $status, $created_at, $updated_at)`,
      {
        id: run.id,
        project_id: projectId,
        title: run.title,
        status: run.status,
        created_at: run.createdAt,
        updated_at: run.updatedAt,
      },
    );
    await connection.run(
      `UPDATE projects SET updated_at = $updated_at WHERE id = $id`,
      { updated_at: ts, id: projectId },
    );
  });
  await appendRunEvent(userId, run.id, {
    type: "run.created",
    payload: { title: run.title, projectId },
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
      project_id: string | null;
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
    const draftRows = await queryRows<{
      brief: string;
      appendix: string;
      updated_at: string;
    }>(
      connection,
      `SELECT brief, appendix, updated_at FROM drafts WHERE run_id = $id`,
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

    const snapshot: RunSnapshot = {
      run: {
        id: row.id,
        projectId: row.project_id || DEFAULT_PROJECT_ID,
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
      events: [],
      draft: draftRows[0]
        ? {
            brief: draftRows[0].brief,
            appendix: draftRows[0].appendix,
            updatedAt: draftRows[0].updated_at,
          }
        : null,
    };
    return snapshot;
  }).then(async (snapshot) => {
    if (!snapshot) return null;
    const events = await listEvents(userId, runId);
    snapshot.events = events;

    for (const ev of events) {
      if (ev.type === "scope.updated" && ev.payload) {
        if (Array.isArray(ev.payload.estimates)) {
          snapshot.estimates = ev.payload.estimates as RunSnapshot["estimates"];
        }
        if (Array.isArray(ev.payload.robustness)) {
          snapshot.robustness = ev.payload.robustness as RunSnapshot["robustness"];
        }
        if (ev.payload.preRegistrationLock) {
          snapshot.preRegistrationLock =
            ev.payload.preRegistrationLock as RunSnapshot["preRegistrationLock"];
        }
      }
    }

    // Surface any scope-change invalidations since the last crew turn started
    let lastTurnStartSeq = -1;
    for (const ev of events) {
      if (ev.type === "run.started") {
        lastTurnStartSeq = ev.seq;
      }
    }
    const invalidatedIds = new Set<string>();
    const invalidatedFields = new Set<string>();
    for (const ev of events) {
      if (
        ev.seq > lastTurnStartSeq &&
        ev.type === "node.status_changed" &&
        ev.payload?.reason === "scope.invalidated"
      ) {
        if (typeof ev.payload.nodeId === "string") {
          invalidatedIds.add(ev.payload.nodeId);
        }
        if (Array.isArray(ev.payload.changedFields)) {
          for (const field of ev.payload.changedFields) {
            if (typeof field === "string") invalidatedFields.add(field);
          }
        }
      }
    }
    if (invalidatedIds.size > 0) {
      snapshot.invalidatedNodeIds = [...invalidatedIds];
      snapshot.invalidatedFields = [...invalidatedFields];
    }

    return snapshot;
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
    draft?: RunDraft | null;
    events?: RunEvent[];
  },
): Promise<void> {
  const ts = nowIso();
  await mutateUserDb(userId, async (connection) => {
    await ensureEventsTable(connection);
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
    if (input.draft) {
      await connection.run(
        `INSERT OR REPLACE INTO drafts (run_id, brief, appendix, updated_at)
         VALUES ($run_id, $brief, $appendix, $updated_at)`,
        {
          run_id: runId,
          brief: input.draft.brief,
          appendix: input.draft.appendix,
          updated_at: input.draft.updatedAt,
        },
      );
    }
    if (input.events && input.events.length > 0) {
      await connection.run(`DELETE FROM events WHERE run_id = $id`, { id: runId });
      for (const [index, ev] of input.events.entries()) {
        await connection.run(
          `INSERT INTO events
            (id, run_id, seq, type, ts, agent, span_id, parent_span_id, payload)
           VALUES
            ($id, $run_id, $seq, $type, $ts, $agent, $span_id, $parent_span_id, $payload)`,
          {
            id: ev.id,
            run_id: runId,
            seq: index,
            type: ev.type,
            ts: ev.ts,
            agent: ev.agent ?? null,
            span_id: ev.spanId ?? null,
            parent_span_id: ev.parentSpanId ?? null,
            payload: JSON.stringify(ev.payload ?? {}),
          },
        );
      }
    }
  });
}

export async function deleteRun(
  userId: string,
  runId: string,
): Promise<boolean> {
  if (!(await assertRunExists(userId, runId))) return false;
  await mutateUserDb(userId, async (connection) => {
    await ensureEventsTable(connection);
    await connection.run(`DELETE FROM messages WHERE run_id = $id`, { id: runId });
    await connection.run(`DELETE FROM nodes WHERE run_id = $id`, { id: runId });
    await connection.run(`DELETE FROM edges WHERE run_id = $id`, { id: runId });
    await connection.run(`DELETE FROM analyses WHERE run_id = $id`, { id: runId });
    await connection.run(`DELETE FROM scopes WHERE run_id = $id`, { id: runId });
    await connection.run(`DELETE FROM drafts WHERE run_id = $id`, { id: runId });
    await connection.run(`DELETE FROM memos WHERE run_id = $id`, { id: runId });
    await connection.run(`DELETE FROM events WHERE run_id = $id`, { id: runId });
    await connection.run(`DELETE FROM runs WHERE id = $id`, { id: runId });
  });
  return true;
}

const SCOPE_DIFF_KINDS: Array<{
  field: keyof ScopeContract;
  kinds: DigressionNodeKind[];
}> = [
  { field: "instrument", kinds: ["constraint", "mechanism", "claim", "incidence"] },
  { field: "jurisdiction", kinds: ["constraint", "mechanism"] },
  { field: "identificationStrategy", kinds: ["evidence", "uncertainty", "claim"] },
  { field: "target", kinds: ["claim", "incidence"] },
  { field: "distributionalCut", kinds: ["incidence", "claim"] },
  { field: "baseline", kinds: ["counterfactual", "fork"] },
  { field: "horizon", kinds: ["counterfactual", "fork", "incidence"] },
  { field: "objective", kinds: ["claim"] },
];

function normText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

export function diffScopeInvalidations(
  prevScope: ScopeContract | null,
  nextScope: ScopeContract,
  nodes: DigressionNode[],
  edges: DigressionEdge[],
): { changedFields: string[]; affectedNodes: DigressionNode[] } {
  if (!prevScope || nodes.length === 0) {
    return { changedFields: [], affectedNodes: [] };
  }

  const changedFields: string[] = [];
  const targetKinds = new Set<DigressionNodeKind>();

  for (const rule of SCOPE_DIFF_KINDS) {
    if (normText(prevScope[rule.field]) !== normText(nextScope[rule.field])) {
      changedFields.push(rule.field);
      for (const kind of rule.kinds) targetKinds.add(kind);
    }
  }

  if (
    prevScope.allowedMethods.slice().sort().join(",") !==
    nextScope.allowedMethods.slice().sort().join(",")
  ) {
    changedFields.push("allowedMethods");
    targetKinds.add("evidence");
    targetKinds.add("claim");
  }

  if (changedFields.length === 0) {
    return { changedFields: [], affectedNodes: [] };
  }

  const affectedIds = new Set<string>();
  for (const node of nodes) {
    if (node.status === "pruned") continue;
    if (targetKinds.has(node.kind)) {
      affectedIds.add(node.id);
    }
  }

  // Propagate 1 hop downstream along edges
  for (const edge of edges) {
    if (affectedIds.has(edge.sourceId)) {
      affectedIds.add(edge.targetId);
    }
  }

  const affectedNodes = nodes.filter(
    (node) => affectedIds.has(node.id) && node.status !== "pruned",
  );
  return { changedFields, affectedNodes };
}

export async function persistScope(
  userId: string,
  runId: string,
  scope: ScopeContract,
): Promise<RunSnapshot | null> {
  const current = await getRun(userId, runId);
  if (!current) return null;

  const ts = nowIso();
  const { changedFields, affectedNodes } = diffScopeInvalidations(
    current.scope,
    scope,
    current.nodes,
    current.edges,
  );

  const updatedNodes: DigressionNode[] = affectedNodes.map((node) => ({
    ...node,
    status: "contested",
    updatedAt: ts,
  }));

  await mutateUserDb(userId, async (connection) => {
    await connection.run(
      `INSERT OR REPLACE INTO scopes (run_id, data) VALUES ($run_id, $data)`,
      { run_id: runId, data: JSON.stringify({ ...scope, updatedAt: ts }) },
    );
    for (const node of updatedNodes) {
      await connection.run(
        `INSERT OR REPLACE INTO nodes (id, run_id, data) VALUES ($id, $run_id, $data)`,
        { id: node.id, run_id: runId, data: JSON.stringify(node) },
      );
    }
    await connection.run(
      `UPDATE runs SET updated_at = $updated_at WHERE id = $id`,
      { updated_at: ts, id: runId },
    );
  });

  await appendRunEvent(userId, runId, {
    type: "scope.updated",
    payload: {
      contract: { ...scope, updatedAt: ts },
      changedFields,
      invalidatedCount: updatedNodes.length,
    },
  });

  for (const node of updatedNodes) {
    await appendRunEvent(userId, runId, {
      type: "node.status_changed",
      agent: "scoper",
      payload: {
        nodeId: node.id,
        status: "contested",
        reason: "scope.invalidated",
        changedFields,
        node,
      },
    });
  }

  return getRun(userId, runId);
}

export async function updateNodeStatus(
  userId: string,
  runId: string,
  nodeId: string,
  status: UserNodeStatus,
): Promise<RunSnapshot | null> {
  const current = await getRun(userId, runId);
  if (!current) return null;
  const node = current.nodes.find((item) => item.id === nodeId);
  if (!node) return null;

  const ts = nowIso();
  const next: DigressionNode = { ...node, status, updatedAt: ts };
  await mutateUserDb(userId, async (connection) => {
    await connection.run(
      `INSERT OR REPLACE INTO nodes (id, run_id, data) VALUES ($id, $run_id, $data)`,
      { id: next.id, run_id: runId, data: JSON.stringify(next) },
    );
    await connection.run(
      `UPDATE runs SET updated_at = $updated_at WHERE id = $id`,
      { updated_at: ts, id: runId },
    );
  });
  await appendRunEvent(userId, runId, {
    type: "node.status_changed",
    payload: { nodeId, status, node: next },
  });
  return getRun(userId, runId);
}
