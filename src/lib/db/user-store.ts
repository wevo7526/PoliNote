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
};

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
`;

const cache = new Map<string, UserDb>();

function usersDir(): string {
  return path.join(process.cwd(), "data", "users");
}

export function userDbPath(userId: string): string {
  if (!isUserId(userId)) {
    throw new Error("Invalid user id");
  }
  return path.join(usersDir(), `${userId}.duckdb`);
}

async function openUserDb(userId: string): Promise<UserDb> {
  const hit = cache.get(userId);
  if (hit) return hit;

  await mkdir(usersDir(), { recursive: true });
  const instance = await DuckDBInstance.create(userDbPath(userId));
  const connection = await instance.connect();
  await connection.run(SCHEMA);
  const db: UserDb = { instance, connection, queue: Promise.resolve() };
  cache.set(userId, db);
  return db;
}

export async function withUserDb<T>(
  userId: string,
  fn: (connection: DuckDBConnection) => Promise<T>,
): Promise<T> {
  const db = await openUserDb(userId);
  const run = db.queue.then(() => fn(db.connection));
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
