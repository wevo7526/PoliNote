import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { toTypedApiError } from "@/lib/env";
import * as schema from "./schema";

export function normalizeDatabaseUrl(rawUrl?: string): string | null {
  const trimmed = (rawUrl ?? process.env.DATABASE_URL ?? "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
  if (!trimmed) return null;
  if (!/^postgres(?:ql)?:\/\//i.test(trimmed)) {
    throw new Error(
      "DATABASE_URL is malformed: expected postgres:// or postgresql:// protocol",
    );
  }
  return trimmed;
}

/**
 * Neon HTTP client for Vercel serverless.
 * Requires a valid DATABASE_URL.
 */
export function createDb(connectionString = process.env.DATABASE_URL) {
  const normalized = normalizeDatabaseUrl(connectionString);
  if (!normalized) {
    throw new Error("DATABASE_URL is not configured");
  }
  const sql = neon(normalized);
  return drizzle(sql, { schema });
}

export type Db = ReturnType<typeof createDb>;

export type DatabaseHealthResult = {
  configured: boolean;
  reachable: boolean;
  engine: "neon-postgres" | "duckdb-local-store";
  latencyMs: number;
  message: string;
};

export async function checkDatabaseHealth(): Promise<DatabaseHealthResult> {
  const start = Date.now();
  const normalized = normalizeDatabaseUrl(process.env.DATABASE_URL);
  if (!normalized) {
    return {
      configured: false,
      reachable: true,
      engine: "duckdb-local-store",
      latencyMs: Date.now() - start,
      message:
        "DATABASE_URL not set; running with embedded per-user DuckDB / JSON store.",
    };
  }

  try {
    const sql = neon(normalized);
    await sql`SELECT 1 AS ok`;
    return {
      configured: true,
      reachable: true,
      engine: "neon-postgres",
      latencyMs: Date.now() - start,
      message: "Neon Postgres reachable (SELECT 1 ok).",
    };
  } catch (error) {
    const typed = toTypedApiError(error, "neon");
    return {
      configured: true,
      reachable: false,
      engine: "neon-postgres",
      latencyMs: Date.now() - start,
      message: typed.message,
    };
  }
}

export * from "./schema";
