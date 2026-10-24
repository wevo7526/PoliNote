import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  DuckDBConnection,
  DuckDBInstance,
  DuckDBValue,
} from "@duckdb/node-api";
import {
  blobPersistenceEnabled,
  hydrateUserDbFile,
  hydrateUserJsonBlob,
  persistUserDbFile,
  persistUserJsonBlob,
} from "@/lib/db/user-db-blob";
import { isUserId } from "@/lib/session";

type DuckApi = typeof import("@duckdb/node-api");

const LINUX_BINDINGS = [
  "node-bindings-linux-x64",
  "node-bindings-linux-x64-musl",
  "node-bindings-linux-arm64",
  "node-bindings-linux-arm64-musl",
];

function pinDuckdbLibraryPath(): void {
  if (process.platform !== "linux") return;
  const roots = [process.cwd(), path.join(process.cwd(), ".next", "server")];
  for (const root of roots) {
    for (const name of LINUX_BINDINGS) {
      const dir = path.join(root, "node_modules", "@duckdb", name);
      if (!existsSync(dir)) continue;
      const current = process.env.LD_LIBRARY_PATH ?? "";
      if (!current.split(":").includes(dir)) {
        process.env.LD_LIBRARY_PATH = current ? `${dir}:${current}` : dir;
      }
      return;
    }
  }
}

let duckApi: Promise<DuckApi> | null = null;

function loadDuckdb(): Promise<DuckApi> {
  if (!duckApi) {
    pinDuckdbLibraryPath();
    duckApi = import("@duckdb/node-api");
  }
  return duckApi;
}

type UserDb = {
  instance: DuckDBInstance;
  connection: DuckDBConnection;
  queue: Promise<unknown>;
  extras: boolean;
};

type JsonStoreDoc = {
  projects: Array<{
    id: string;
    title: string;
    description: string;
    context_memo: string;
    created_at: string;
    updated_at: string;
  }>;
  runs: Array<{
    id: string;
    project_id: string | null;
    title: string;
    status: string;
    created_at: string;
    updated_at: string;
  }>;
  messages: Array<{
    id: string;
    run_id: string;
    seq: number;
    kind: string;
    payload: string;
    created_at: string;
  }>;
  nodes: Array<{ id: string; run_id: string; data: string }>;
  edges: Array<{ id: string; run_id: string; data: string }>;
  scopes: Array<{ run_id: string; data: string }>;
  analyses: Array<{
    node_id: string;
    run_id: string;
    title: string;
    body: string;
    citations: string;
  }>;
  drafts: Array<{
    run_id: string;
    brief: string;
    appendix: string;
    updated_at: string;
  }>;
  memos: Array<{ run_id: string; body: string; updated_at: string }>;
  events: Array<{
    id: string;
    run_id: string;
    seq: number;
    type: string;
    ts: string;
    agent: string | null;
    span_id: string | null;
    parent_span_id: string | null;
    payload: string;
  }>;
};

type DuckCache = {
  dbs: Map<string, UserDb>;
  opening: Map<string, Promise<UserDb>>;
  queues: Map<string, Promise<unknown>>;
  hydrated: Set<string>;
  jsonDocs: Map<string, JsonStoreDoc>;
  duckFailed: boolean;
};

const globalForDuck = globalThis as typeof globalThis & {
  __polinoteDuck?: DuckCache;
};

function duckCache(): DuckCache {
  if (!globalForDuck.__polinoteDuck) {
    globalForDuck.__polinoteDuck = {
      dbs: new Map(),
      opening: new Map(),
      queues: new Map(),
      hydrated: new Set(),
      jsonDocs: new Map(),
      duckFailed: false,
    };
  }
  return globalForDuck.__polinoteDuck;
}

function isEphemeralRuntime(): boolean {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id VARCHAR PRIMARY KEY,
  title VARCHAR NOT NULL,
  description VARCHAR NOT NULL,
  context_memo VARCHAR NOT NULL,
  created_at VARCHAR NOT NULL,
  updated_at VARCHAR NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR,
  title VARCHAR NOT NULL,
  status VARCHAR NOT NULL,
  created_at VARCHAR NOT NULL,
  updated_at VARCHAR NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id VARCHAR PRIMARY KEY,
  run_id VARCHAR NOT NULL,
  seq INTEGER NOT NULL,
  kind VARCHAR NOT NULL,
  payload JSON NOT NULL,
  created_at VARCHAR NOT NULL
);
CREATE TABLE IF NOT EXISTS nodes (
  id VARCHAR PRIMARY KEY,
  run_id VARCHAR NOT NULL,
  data JSON NOT NULL
);
CREATE TABLE IF NOT EXISTS edges (
  id VARCHAR PRIMARY KEY,
  run_id VARCHAR NOT NULL,
  data JSON NOT NULL
);
CREATE TABLE IF NOT EXISTS scopes (
  run_id VARCHAR PRIMARY KEY,
  data JSON NOT NULL
);
CREATE TABLE IF NOT EXISTS analyses (
  node_id VARCHAR PRIMARY KEY,
  run_id VARCHAR NOT NULL,
  title VARCHAR NOT NULL,
  body VARCHAR NOT NULL,
  citations JSON NOT NULL
);
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
CREATE TABLE IF NOT EXISTS drafts (
  run_id VARCHAR PRIMARY KEY,
  brief VARCHAR NOT NULL,
  appendix VARCHAR NOT NULL,
  updated_at VARCHAR NOT NULL
);
CREATE TABLE IF NOT EXISTS memos (
  run_id VARCHAR PRIMARY KEY,
  body VARCHAR NOT NULL,
  updated_at VARCHAR NOT NULL
);
`;

const EXTRA_SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id VARCHAR PRIMARY KEY,
  title VARCHAR NOT NULL,
  description VARCHAR NOT NULL,
  context_memo VARCHAR NOT NULL,
  created_at VARCHAR NOT NULL,
  updated_at VARCHAR NOT NULL
);
ALTER TABLE runs ADD COLUMN IF NOT EXISTS project_id VARCHAR;
CREATE TABLE IF NOT EXISTS drafts (
  run_id VARCHAR PRIMARY KEY,
  brief VARCHAR NOT NULL,
  appendix VARCHAR NOT NULL,
  updated_at VARCHAR NOT NULL
);
CREATE TABLE IF NOT EXISTS memos (
  run_id VARCHAR PRIMARY KEY,
  body VARCHAR NOT NULL,
  updated_at VARCHAR NOT NULL
);
`;

function usersDir(): string {
  const root =
    process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
      ? path.join("/tmp", "polinote")
      : process.cwd();
  return path.join(root, "data", "users");
}

export function userDbPath(userId: string): string {
  if (!isUserId(userId)) {
    throw new Error("Invalid user id");
  }
  return path.join(usersDir(), `${userId}.duckdb`);
}

function userJsonPath(userId: string): string {
  if (!isUserId(userId)) {
    throw new Error("Invalid user id");
  }
  return path.join(usersDir(), `${userId}.json`);
}

function emptyJsonDoc(): JsonStoreDoc {
  return {
    projects: [],
    runs: [],
    messages: [],
    nodes: [],
    edges: [],
    scopes: [],
    analyses: [],
    drafts: [],
    memos: [],
    events: [],
  };
}

async function loadJsonDoc(userId: string): Promise<JsonStoreDoc> {
  const cache = duckCache();
  const cached = cache.jsonDocs.get(userId);
  if (cached) return cached;

  await mkdir(usersDir(), { recursive: true });
  const filePath = userJsonPath(userId);

  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<JsonStoreDoc>;
    const doc: JsonStoreDoc = { ...emptyJsonDoc(), ...parsed };
    cache.jsonDocs.set(userId, doc);
    return doc;
  } catch {
    /* try blob */
  }

  const fromBlob = await hydrateUserJsonBlob(userId);
  if (fromBlob) {
    try {
      const parsed = JSON.parse(fromBlob) as Partial<JsonStoreDoc>;
      const doc: JsonStoreDoc = { ...emptyJsonDoc(), ...parsed };
      cache.jsonDocs.set(userId, doc);
      await writeFile(filePath, JSON.stringify(doc), "utf8").catch(() => undefined);
      return doc;
    } catch {
      /* ignore */
    }
  }

  const fresh = emptyJsonDoc();
  cache.jsonDocs.set(userId, fresh);
  return fresh;
}

async function saveJsonDoc(userId: string, doc: JsonStoreDoc): Promise<void> {
  const cache = duckCache();
  cache.jsonDocs.set(userId, doc);
  await mkdir(usersDir(), { recursive: true });
  const text = JSON.stringify(doc);
  await writeFile(userJsonPath(userId), text, "utf8").catch(() => undefined);
  await persistUserJsonBlob(userId, text);
}

function executeJsonSql(
  doc: JsonStoreDoc,
  sql: string,
  params: Record<string, unknown> = {},
): Array<Record<string, unknown>> {
  const norm = sql.replace(/\s+/g, " ").trim();

  if (
    /^CREATE\s/i.test(norm) ||
    /^ALTER\s/i.test(norm) ||
    /^CHECKPOINT/i.test(norm)
  ) {
    return [];
  }

  // projects
  if (/^SELECT .+ FROM projects ORDER BY updated_at DESC$/i.test(norm)) {
    return [...doc.projects].sort((a, b) =>
      b.updated_at.localeCompare(a.updated_at),
    );
  }
  if (/^SELECT .+ FROM projects WHERE id = \$id$/i.test(norm)) {
    const id = String(params.id ?? "");
    return doc.projects.filter((p) => p.id === id);
  }
  if (/^INSERT OR IGNORE INTO projects/i.test(norm)) {
    const id = String(params.id ?? "");
    if (!doc.projects.some((p) => p.id === id)) {
      doc.projects.push({
        id,
        title: String(params.title ?? ""),
        description: String(params.description ?? ""),
        context_memo: String(params.context_memo ?? ""),
        created_at: String(params.created_at ?? ""),
        updated_at: String(params.updated_at ?? ""),
      });
    }
    return [];
  }
  if (/^INSERT (?:OR REPLACE )?INTO projects/i.test(norm)) {
    const id = String(params.id ?? "");
    const row = {
      id,
      title: String(params.title ?? ""),
      description: String(params.description ?? ""),
      context_memo: String(params.context_memo ?? ""),
      created_at: String(params.created_at ?? ""),
      updated_at: String(params.updated_at ?? ""),
    };
    const idx = doc.projects.findIndex((p) => p.id === id);
    if (idx >= 0) doc.projects[idx] = row;
    else doc.projects.push(row);
    return [];
  }
  if (
    /^UPDATE projects SET title = \$title, description = \$description, context_memo = \$context_memo, updated_at = \$updated_at WHERE id = \$id$/i.test(
      norm,
    )
  ) {
    const id = String(params.id ?? "");
    for (const p of doc.projects) {
      if (p.id === id) {
        p.title = String(params.title ?? p.title);
        p.description = String(params.description ?? p.description);
        p.context_memo = String(params.context_memo ?? p.context_memo);
        p.updated_at = String(params.updated_at ?? p.updated_at);
      }
    }
    return [];
  }
  if (/^UPDATE projects SET updated_at = \$updated_at WHERE id = \$id$/i.test(norm)) {
    const id = String(params.id ?? "");
    for (const p of doc.projects) {
      if (p.id === id) {
        p.updated_at = String(params.updated_at ?? p.updated_at);
      }
    }
    return [];
  }
  if (/^DELETE FROM projects WHERE id = \$id$/i.test(norm)) {
    const id = String(params.id ?? "");
    doc.projects = doc.projects.filter((p) => p.id !== id);
    return [];
  }

  // runs
  if (
    /^SELECT COUNT\(\*\) AS cnt FROM runs WHERE project_id IS NULL OR project_id = ''$/i.test(
      norm,
    )
  ) {
    const cnt = doc.runs.filter((r) => !r.project_id).length;
    return [{ cnt }];
  }
  if (
    /^UPDATE runs SET project_id = \$project_id WHERE project_id IS NULL OR project_id = ''$/i.test(
      norm,
    )
  ) {
    const pid = String(params.project_id ?? "");
    for (const r of doc.runs) {
      if (!r.project_id) r.project_id = pid;
    }
    return [];
  }
  if (
    /^SELECT id, title FROM runs WHERE project_id = \$project_id ORDER BY updated_at DESC LIMIT 6$/i.test(
      norm,
    )
  ) {
    const pid = String(params.project_id ?? "");
    return doc.runs
      .filter((r) => r.project_id === pid)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, 6)
      .map((r) => ({ id: r.id, title: r.title }));
  }
  if (/^SELECT id FROM runs WHERE project_id = \$project_id$/i.test(norm)) {
    const pid = String(params.project_id ?? "");
    return doc.runs.filter((r) => r.project_id === pid).map((r) => ({ id: r.id }));
  }
  if (/^SELECT .+ FROM runs ORDER BY updated_at DESC$/i.test(norm)) {
    return [...doc.runs].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }
  if (/^SELECT \* FROM runs WHERE id = \$id$/i.test(norm) || /^SELECT id FROM runs WHERE id = \$id$/i.test(norm)) {
    const id = String(params.id ?? "");
    return doc.runs.filter((r) => r.id === id);
  }
  if (/^INSERT (?:OR IGNORE |OR REPLACE )?INTO runs/i.test(norm)) {
    const id = String(params.id ?? "");
    const existingIdx = doc.runs.findIndex((r) => r.id === id);
    if (/OR IGNORE/i.test(norm) && existingIdx >= 0) return [];
    const row = {
      id,
      project_id: params.project_id ? String(params.project_id) : null,
      title: String(params.title ?? ""),
      status: String(params.status ?? "draft"),
      created_at: String(params.created_at ?? ""),
      updated_at: String(params.updated_at ?? ""),
    };
    if (existingIdx >= 0) doc.runs[existingIdx] = row;
    else doc.runs.push(row);
    return [];
  }
  if (
    /^UPDATE runs SET title = \$title, status = \$status, updated_at = \$updated_at WHERE id = \$id$/i.test(
      norm,
    )
  ) {
    const id = String(params.id ?? "");
    for (const r of doc.runs) {
      if (r.id === id) {
        r.title = String(params.title ?? r.title);
        r.status = String(params.status ?? r.status);
        r.updated_at = String(params.updated_at ?? r.updated_at);
      }
    }
    return [];
  }
  if (/^UPDATE runs SET updated_at = \$updated_at WHERE id = \$id$/i.test(norm)) {
    const id = String(params.id ?? "");
    for (const r of doc.runs) {
      if (r.id === id) r.updated_at = String(params.updated_at ?? r.updated_at);
    }
    return [];
  }
  if (/^DELETE FROM runs WHERE id = \$id$/i.test(norm)) {
    const id = String(params.id ?? "");
    doc.runs = doc.runs.filter((r) => r.id !== id);
    return [];
  }

  // messages
  if (/^SELECT payload FROM messages WHERE run_id = \$id ORDER BY seq ASC$/i.test(norm)) {
    const id = String(params.id ?? "");
    return doc.messages
      .filter((m) => m.run_id === id)
      .sort((a, b) => a.seq - b.seq)
      .map((m) => ({ payload: m.payload }));
  }
  if (/^DELETE FROM messages WHERE run_id = \$id$/i.test(norm)) {
    const id = String(params.id ?? "");
    doc.messages = doc.messages.filter((m) => m.run_id !== id);
    return [];
  }
  if (/^INSERT INTO messages/i.test(norm)) {
    doc.messages.push({
      id: String(params.id ?? ""),
      run_id: String(params.run_id ?? ""),
      seq: Number(params.seq ?? 0),
      kind: String(params.kind ?? ""),
      payload: String(params.payload ?? "{}"),
      created_at: String(params.created_at ?? ""),
    });
    return [];
  }

  // nodes
  if (/^SELECT data FROM nodes WHERE run_id = \$id$/i.test(norm)) {
    const id = String(params.id ?? "");
    return doc.nodes.filter((n) => n.run_id === id).map((n) => ({ data: n.data }));
  }
  if (/^DELETE FROM nodes WHERE run_id = \$id$/i.test(norm)) {
    const id = String(params.id ?? "");
    doc.nodes = doc.nodes.filter((n) => n.run_id !== id);
    return [];
  }
  if (/^INSERT (?:OR REPLACE )?INTO nodes/i.test(norm)) {
    const id = String(params.id ?? "");
    const row = {
      id,
      run_id: String(params.run_id ?? ""),
      data: String(params.data ?? "{}"),
    };
    const idx = doc.nodes.findIndex((n) => n.id === id);
    if (idx >= 0) doc.nodes[idx] = row;
    else doc.nodes.push(row);
    return [];
  }

  // edges
  if (/^SELECT data FROM edges WHERE run_id = \$id$/i.test(norm)) {
    const id = String(params.id ?? "");
    return doc.edges.filter((e) => e.run_id === id).map((e) => ({ data: e.data }));
  }
  if (/^DELETE FROM edges WHERE run_id = \$id$/i.test(norm)) {
    const id = String(params.id ?? "");
    doc.edges = doc.edges.filter((e) => e.run_id !== id);
    return [];
  }
  if (/^INSERT INTO edges/i.test(norm)) {
    doc.edges.push({
      id: String(params.id ?? ""),
      run_id: String(params.run_id ?? ""),
      data: String(params.data ?? "{}"),
    });
    return [];
  }

  // scopes
  if (/^SELECT data FROM scopes WHERE run_id = \$id$/i.test(norm)) {
    const id = String(params.id ?? "");
    return doc.scopes.filter((s) => s.run_id === id).map((s) => ({ data: s.data }));
  }
  if (/^DELETE FROM scopes WHERE run_id = \$id$/i.test(norm)) {
    const id = String(params.id ?? "");
    doc.scopes = doc.scopes.filter((s) => s.run_id !== id);
    return [];
  }
  if (/^INSERT OR REPLACE INTO scopes/i.test(norm)) {
    const runId = String(params.run_id ?? "");
    const row = { run_id: runId, data: String(params.data ?? "{}") };
    const idx = doc.scopes.findIndex((s) => s.run_id === runId);
    if (idx >= 0) doc.scopes[idx] = row;
    else doc.scopes.push(row);
    return [];
  }

  // analyses
  if (/^SELECT .+ FROM analyses WHERE run_id = \$id$/i.test(norm)) {
    const id = String(params.id ?? "");
    return doc.analyses.filter((a) => a.run_id === id);
  }
  if (/^DELETE FROM analyses WHERE run_id = \$id$/i.test(norm)) {
    const id = String(params.id ?? "");
    doc.analyses = doc.analyses.filter((a) => a.run_id !== id);
    return [];
  }
  if (/^INSERT INTO analyses/i.test(norm)) {
    const nodeId = String(params.node_id ?? "");
    const row = {
      node_id: nodeId,
      run_id: String(params.run_id ?? ""),
      title: String(params.title ?? ""),
      body: String(params.body ?? ""),
      citations: String(params.citations ?? "[]"),
    };
    const idx = doc.analyses.findIndex((a) => a.node_id === nodeId);
    if (idx >= 0) doc.analyses[idx] = row;
    else doc.analyses.push(row);
    return [];
  }

  // drafts
  if (/^SELECT brief, appendix, updated_at FROM drafts WHERE run_id = \$id$/i.test(norm)) {
    const id = String(params.id ?? "");
    return doc.drafts.filter((d) => d.run_id === id);
  }
  if (/^DELETE FROM drafts WHERE run_id = \$id$/i.test(norm)) {
    const id = String(params.id ?? "");
    doc.drafts = doc.drafts.filter((d) => d.run_id !== id);
    return [];
  }
  if (/^INSERT OR REPLACE INTO drafts/i.test(norm)) {
    const runId = String(params.run_id ?? "");
    const row = {
      run_id: runId,
      brief: String(params.brief ?? ""),
      appendix: String(params.appendix ?? ""),
      updated_at: String(params.updated_at ?? ""),
    };
    const idx = doc.drafts.findIndex((d) => d.run_id === runId);
    if (idx >= 0) doc.drafts[idx] = row;
    else doc.drafts.push(row);
    return [];
  }

  // memos
  if (/^SELECT body FROM memos WHERE run_id = \$run_id$/i.test(norm)) {
    const runId = String(params.run_id ?? "");
    return doc.memos.filter((m) => m.run_id === runId).map((m) => ({ body: m.body }));
  }
  if (/^DELETE FROM memos WHERE run_id = \$id$/i.test(norm)) {
    const id = String(params.id ?? "");
    doc.memos = doc.memos.filter((m) => m.run_id !== id);
    return [];
  }
  if (/^INSERT OR REPLACE INTO memos/i.test(norm)) {
    const runId = String(params.run_id ?? "");
    const row = {
      run_id: runId,
      body: String(params.body ?? ""),
      updated_at: String(params.updated_at ?? ""),
    };
    const idx = doc.memos.findIndex((m) => m.run_id === runId);
    if (idx >= 0) doc.memos[idx] = row;
    else doc.memos.push(row);
    return [];
  }

  // events
  if (/^SELECT .+ FROM events WHERE run_id = \$run_id AND seq > \$after ORDER BY seq ASC$/i.test(norm)) {
    const runId = String(params.run_id ?? "");
    const after = Number(params.after ?? -1);
    return doc.events
      .filter((e) => e.run_id === runId && e.seq > after)
      .sort((a, b) => a.seq - b.seq);
  }
  if (/^SELECT COALESCE\(MAX\(seq\), -1\) \+ 1 AS next FROM events WHERE run_id = \$run_id$/i.test(norm)) {
    const runId = String(params.run_id ?? "");
    const matching = doc.events.filter((e) => e.run_id === runId);
    const maxSeq = matching.reduce((max, e) => Math.max(max, e.seq), -1);
    return [{ next: maxSeq + 1 }];
  }
  if (/^DELETE FROM events WHERE run_id = \$id$/i.test(norm)) {
    const id = String(params.id ?? "");
    doc.events = doc.events.filter((e) => e.run_id !== id);
    return [];
  }
  if (/^INSERT INTO events/i.test(norm)) {
    doc.events.push({
      id: String(params.id ?? ""),
      run_id: String(params.run_id ?? ""),
      seq: Number(params.seq ?? 0),
      type: String(params.type ?? ""),
      ts: String(params.ts ?? ""),
      agent: params.agent !== null && params.agent !== undefined ? String(params.agent) : null,
      span_id: params.span_id !== null && params.span_id !== undefined ? String(params.span_id) : null,
      parent_span_id:
        params.parent_span_id !== null && params.parent_span_id !== undefined
          ? String(params.parent_span_id)
          : null,
      payload: String(params.payload ?? "{}"),
    });
    return [];
  }

  return [];
}

function createJsonConnection(doc: JsonStoreDoc): DuckDBConnection {
  const shim = {
    async run(sql: string, params?: Record<string, unknown>) {
      executeJsonSql(doc, sql, params);
      return {};
    },
    async runAndReadAll(sql: string, params?: Record<string, unknown>) {
      const rows = executeJsonSql(doc, sql, params);
      return {
        getRowObjectsJS() {
          return rows;
        },
      };
    },
    closeSync() {
      /* no-op */
    },
  };
  return shim as unknown as DuckDBConnection;
}

async function withJsonUserDb<T>(
  userId: string,
  fn: (connection: DuckDBConnection) => Promise<T>,
  persist: boolean,
): Promise<T> {
  const doc = await loadJsonDoc(userId);
  const conn = createJsonConnection(doc);
  const result = await fn(conn);
  if (persist) {
    await saveJsonDoc(userId, doc);
  }
  return result;
}

function closeQuietly(instance: DuckDBInstance, connection?: DuckDBConnection): void {
  try {
    connection?.closeSync();
  } catch {
    /* already closed */
  }
  try {
    instance.closeSync();
  } catch {
    /* already closed */
  }
}

async function openUserDb(userId: string): Promise<UserDb> {
  const cache = duckCache();
  const hit = cache.dbs.get(userId);
  if (hit) return hit;

  const inflight = cache.opening.get(userId);
  if (inflight) return inflight;

  const opening = (async () => {
    await mkdir(usersDir(), { recursive: true });
    const filePath = userDbPath(userId);
    const { DuckDBInstance } = await loadDuckdb();
    const instance = await DuckDBInstance.fromCache(filePath);
    const existing = cache.dbs.get(userId);
    if (existing) return existing;

    const connection = await instance.connect();
    await connection.run(SCHEMA);
    await connection.run(EXTRA_SCHEMA);
    const db: UserDb = { instance, connection, queue: Promise.resolve(), extras: true };
    cache.dbs.set(userId, db);
    return db;
  })().finally(() => {
    cache.opening.delete(userId);
  });

  cache.opening.set(userId, opening);
  return opening;
}

async function withLocalUserDb<T>(
  userId: string,
  fn: (connection: DuckDBConnection) => Promise<T>,
  persist: boolean,
): Promise<T> {
  const cache = duckCache();
  if (cache.duckFailed) {
    return withJsonUserDb(userId, fn, persist);
  }
  try {
    const db = await openUserDb(userId);
    const run = db.queue.then(async () => {
      if (!db.extras) {
        await db.connection.run(EXTRA_SCHEMA);
        db.extras = true;
      }
      return fn(db.connection);
    });
    db.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return await run;
  } catch {
    cache.duckFailed = true;
    return withJsonUserDb(userId, fn, persist);
  }
}

async function withEphemeralUserDb<T>(
  userId: string,
  fn: (connection: DuckDBConnection) => Promise<T>,
  persist: boolean,
): Promise<T> {
  const cache = duckCache();
  if (cache.duckFailed) {
    return withJsonUserDb(userId, fn, persist);
  }

  try {
    await mkdir(usersDir(), { recursive: true });
    const filePath = userDbPath(userId);
    if (!cache.hydrated.has(userId) || !existsSync(filePath)) {
      await hydrateUserDbFile(userId, filePath);
      cache.hydrated.add(userId);
    }
    const { DuckDBInstance } = await loadDuckdb();
    const instance = await DuckDBInstance.create(filePath);
    const connection = await instance.connect();
    try {
      await connection.run(SCHEMA);
      await connection.run(EXTRA_SCHEMA);
      const result = await fn(connection);
      if (persist) {
        await connection.run("CHECKPOINT");
        closeQuietly(instance, connection);
        if (blobPersistenceEnabled()) {
          await persistUserDbFile(userId, filePath);
        }
      }
      return result;
    } finally {
      closeQuietly(instance, connection);
    }
  } catch {
    cache.duckFailed = true;
    return withJsonUserDb(userId, fn, persist);
  }
}

export async function withUserDb<T>(
  userId: string,
  fn: (connection: DuckDBConnection) => Promise<T>,
  options?: { persist?: boolean },
): Promise<T> {
  const persist = Boolean(options?.persist);
  if (!isEphemeralRuntime()) {
    return withLocalUserDb(userId, fn, persist);
  }

  const cache = duckCache();
  const previous = cache.queues.get(userId) ?? Promise.resolve();
  const run = previous.then(() =>
    withEphemeralUserDb(userId, fn, persist),
  );
  cache.queues.set(
    userId,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

export async function mutateUserDb<T>(
  userId: string,
  fn: (connection: DuckDBConnection) => Promise<T>,
): Promise<T> {
  return withUserDb(userId, fn, { persist: true });
}

export async function queryRows<T extends Record<string, unknown>>(
  connection: DuckDBConnection,
  sql: string,
  params?: Record<string, DuckDBValue>,
): Promise<T[]> {
  const reader = params
    ? await connection.runAndReadAll(sql, params)
    : await connection.runAndReadAll(sql);
  return reader.getRowObjectsJS() as T[];
}

export function asJson<T>(value: unknown): T {
  if (typeof value === "string") return JSON.parse(value) as T;
  return value as T;
}
