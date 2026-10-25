import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { BlobNotFoundError, get, put } from "@vercel/blob";
import { normalizeDatabaseUrl } from "@/db";
import { blobPersistenceEnabled } from "@/lib/db/user-db-blob";

type RateWindow = {
  timestamps: number[];
};

export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  resetInMs: number;
  backend: "postgres" | "vercel-blob" | "shared-file";
};

function sanitizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 96);
}

let pgTableEnsured = false;

async function checkPostgresRateLimit(
  dbUrl: string,
  key: string,
  maxRequests: number,
  windowMs: number,
): Promise<RateLimitDecision> {
  const sql = neon(dbUrl);
  if (!pgTableEnsured) {
    await sql`
      CREATE TABLE IF NOT EXISTS polinote_rate_limits (
        bucket_key TEXT PRIMARY KEY,
        timestamps JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    pgTableEnsured = true;
  }

  const now = Date.now();
  const cutoff = now - windowMs;
  const rows = (await sql`
    SELECT timestamps FROM polinote_rate_limits WHERE bucket_key = ${key}
  `) as Array<{ timestamps?: unknown }>;

  const rawList = Array.isArray(rows[0]?.timestamps)
    ? (rows[0]!.timestamps as number[])
    : [];
  const active = rawList.filter((t) => typeof t === "number" && t > cutoff);

  if (active.length >= maxRequests) {
    const oldest = active[0] ?? now;
    await sql`
      INSERT INTO polinote_rate_limits (bucket_key, timestamps, updated_at)
      VALUES (${key}, ${JSON.stringify(active)}::jsonb, NOW())
      ON CONFLICT (bucket_key) DO UPDATE
      SET timestamps = ${JSON.stringify(active)}::jsonb, updated_at = NOW()
    `;
    return {
      allowed: false,
      remaining: 0,
      resetInMs: Math.max(1000, oldest + windowMs - now),
      backend: "postgres",
    };
  }

  active.push(now);
  await sql`
    INSERT INTO polinote_rate_limits (bucket_key, timestamps, updated_at)
    VALUES (${key}, ${JSON.stringify(active)}::jsonb, NOW())
    ON CONFLICT (bucket_key) DO UPDATE
    SET timestamps = ${JSON.stringify(active)}::jsonb, updated_at = NOW()
  `;

  return {
    allowed: true,
    remaining: Math.max(0, maxRequests - active.length),
    resetInMs: windowMs,
    backend: "postgres",
  };
}

async function checkBlobRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): Promise<RateLimitDecision> {
  const blobPath = `rate-limits/${sanitizeKey(key)}.json`;
  const now = Date.now();
  const cutoff = now - windowMs;
  let existing: number[] = [];

  try {
    const res = await get(blobPath, { access: "private", useCache: false });
    if (res && res.statusCode === 200 && res.stream) {
      const text = await new Response(res.stream).text();
      const parsed = JSON.parse(text) as RateWindow;
      if (Array.isArray(parsed.timestamps)) {
        existing = parsed.timestamps.filter(
          (t) => typeof t === "number" && t > cutoff,
        );
      }
    }
  } catch (error) {
    if (!(error instanceof BlobNotFoundError)) {
      // ignore transient read error and continue
    }
  }

  if (existing.length >= maxRequests) {
    const oldest = existing[0] ?? now;
    return {
      allowed: false,
      remaining: 0,
      resetInMs: Math.max(1000, oldest + windowMs - now),
      backend: "vercel-blob",
    };
  }

  existing.push(now);
  try {
    await put(blobPath, JSON.stringify({ timestamps: existing }), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
  } catch {
    /* non-fatal write */
  }

  return {
    allowed: true,
    remaining: Math.max(0, maxRequests - existing.length),
    resetInMs: windowMs,
    backend: "vercel-blob",
  };
}

async function checkFileRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): Promise<RateLimitDecision> {
  const root =
    process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
      ? path.join("/tmp", "polinote")
      : process.cwd();
  const dir = path.join(root, "data", "rate-limits");
  const filePath = path.join(dir, `${sanitizeKey(key)}.json`);
  const now = Date.now();
  const cutoff = now - windowMs;
  let existing: number[] = [];

  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as RateWindow;
    if (Array.isArray(parsed.timestamps)) {
      existing = parsed.timestamps.filter(
        (t) => typeof t === "number" && t > cutoff,
      );
    }
  } catch {
    /* first request */
  }

  if (existing.length >= maxRequests) {
    const oldest = existing[0] ?? now;
    return {
      allowed: false,
      remaining: 0,
      resetInMs: Math.max(1000, oldest + windowMs - now),
      backend: "shared-file",
    };
  }

  existing.push(now);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(
      filePath,
      JSON.stringify({ timestamps: existing }),
      "utf8",
    );
  } catch {
    /* ignore */
  }

  return {
    allowed: true,
    remaining: Math.max(0, maxRequests - existing.length),
    resetInMs: windowMs,
    backend: "shared-file",
  };
}

/**
 * Shared sliding-window rate limiter:
 * 1. Uses Neon Postgres (`polinote_rate_limits` table) when `DATABASE_URL` is configured.
 * 2. Otherwise uses Vercel Blob (`rate-limits/{key}.json`) when `BLOB_READ_WRITE_TOKEN` is configured.
 * 3. Falls back to shared disk file in local development/test.
 */
export async function checkRateLimit(
  key: string,
  maxRequests = 30,
  windowMs = 60_000,
): Promise<RateLimitDecision> {
  try {
    const dbUrl = normalizeDatabaseUrl(process.env.DATABASE_URL);
    if (dbUrl) {
      return await checkPostgresRateLimit(dbUrl, key, maxRequests, windowMs);
    }
  } catch {
    /* fall through to Blob / file */
  }

  if (blobPersistenceEnabled()) {
    return checkBlobRateLimit(key, maxRequests, windowMs);
  }

  return checkFileRateLimit(key, maxRequests, windowMs);
}

export type RunTelemetryRecord = {
  runId: string;
  modelId: string;
  promptVersion: string;
  gitSha: string;
  estimatedTokens: number;
  estimatedCostUsd: number;
  steps: Array<{
    step: string;
    status: "completed" | "failed" | "skipped";
    durationMs: number;
    detail?: string;
  }>;
};

export const CURRENT_PROMPT_VERSION = "polinote-econometrics-v2.5";
export const CURRENT_CODE_VERSION =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "local-v2";
