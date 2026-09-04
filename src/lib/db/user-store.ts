import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  DuckDBConnection,
  DuckDBInstance,
  type DuckDBValue,
} from "@duckdb/node-api";
import { isUserId } from "@/lib/session";

type UserDb = {
  instance: DuckDBInstance;
  connection: DuckDBConnection;
  queue: Promise<unknown>;
  extras: boolean;
};

type DuckCache = {
  dbs: Map<string, UserDb>;
  opening: Map<string, Promise<UserDb>>;
};

const globalForDuck = globalThis as typeof globalThis & {
  __polinoteDuck?: DuckCache;
};

function duckCache(): DuckCache {
  if (!globalForDuck.__polinoteDuck) {
    globalForDuck.__polinoteDuck = {
      dbs: new Map(),
      opening: new Map(),
    };
  }
  return globalForDuck.__polinoteDuck;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id VARCHAR PRIMARY KEY,
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

async function openUserDb(userId: string): Promise<UserDb> {
  const cache = duckCache();
  const hit = cache.dbs.get(userId);
  if (hit) return hit;

  const inflight = cache.opening.get(userId);
  if (inflight) return inflight;

  const opening = (async () => {
    await mkdir(usersDir(), { recursive: true });
    const filePath = userDbPath(userId);
    const instance = await DuckDBInstance.fromCache(filePath);
    const existing = cache.dbs.get(userId);
    if (existing) return existing;

    const connection = await instance.connect();
    await connection.run(SCHEMA);
    const db: UserDb = { instance, connection, queue: Promise.resolve(), extras: true };
    cache.dbs.set(userId, db);
    return db;
  })().finally(() => {
    cache.opening.delete(userId);
  });

  cache.opening.set(userId, opening);
  return opening;
}

export async function withUserDb<T>(
  userId: string,
  fn: (connection: DuckDBConnection) => Promise<T>,
): Promise<T> {
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
  return run;
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
