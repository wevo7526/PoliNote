import { createHash } from "node:crypto";
import { redactSecrets } from "@/lib/mcp/http";
import {
  DataUnavailableError,
  type DataProviderId,
  type RawSnapshotRecord,
} from "./types";

type CacheEntry = {
  expiresAt: number;
  rawText: string;
  sha256: string;
};

/**
 * Short-TTL in-memory HTTP cache used ONLY to deduplicate identical requests
 * within a single run execution window (default 45 seconds).
 * Every new run re-fetches live data from source APIs.
 */
const SHORT_TTL_MS = 45_000;
const httpCache = new Map<string, CacheEntry>();

export function clearRunHttpCache(): void {
  httpCache.clear();
}

export function sha256Hex(payload: string): string {
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export function createSnapshotRecord(input: {
  provider: DataProviderId;
  seriesId: string;
  requestUrl: string;
  rawJson: string;
  retrievedAt?: string;
}): RawSnapshotRecord {
  const retrievedAt = input.retrievedAt ?? new Date().toISOString();
  const sha256 = sha256Hex(input.rawJson);
  const safeUrl = redactSecrets(input.requestUrl);
  return {
    id: `snap_${input.provider}_${input.seriesId.replace(/[^a-zA-Z0-9_-]/g, "_")}_${sha256.slice(0, 12)}`,
    provider: input.provider,
    seriesId: input.seriesId,
    requestUrl: safeUrl,
    retrievedAt,
    sha256,
    byteLength: Buffer.byteLength(input.rawJson, "utf8"),
    rawJson: input.rawJson,
  };
}

export async function fetchLiveJsonWithSnapshot<T>(input: {
  provider: DataProviderId;
  seriesId: string;
  url: string;
  init?: RequestInit;
  timeoutMs?: number;
  bypassDedupeCache?: boolean;
}): Promise<{ data: T; snapshot: RawSnapshotRecord }> {
  const now = Date.now();
  const cacheKey = `${input.provider}:${input.init?.method ?? "GET"}:${input.url}:${typeof input.init?.body === "string" ? input.init.body : ""}`;

  if (!input.bypassDedupeCache) {
    const hit = httpCache.get(cacheKey);
    if (hit && hit.expiresAt > now) {
      const parsed = JSON.parse(hit.rawText) as T;
      return {
        data: parsed,
        snapshot: createSnapshotRecord({
          provider: input.provider,
          seriesId: input.seriesId,
          requestUrl: input.url,
          rawJson: hit.rawText,
        }),
      };
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    input.timeoutMs ?? 12_000,
  );

  try {
    const response = await fetch(input.url, {
      ...input.init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(input.init?.headers ?? {}),
      },
    });

    const rawText = await response.text();
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const errObj = JSON.parse(rawText) as {
          error_message?: string;
          message?: string;
          error?: string;
        };
        const msg = errObj.error_message || errObj.message || errObj.error;
        if (msg) detail = `HTTP ${response.status} (${redactSecrets(msg)})`;
      } catch {
        /* ignore non-json body */
      }
      throw new DataUnavailableError(input.provider, detail);
    }

    let parsed: T;
    try {
      parsed = JSON.parse(rawText) as T;
    } catch {
      throw new DataUnavailableError(
        input.provider,
        "Provider returned malformed JSON payload",
      );
    }

    const sha256 = sha256Hex(rawText);
    httpCache.set(cacheKey, {
      expiresAt: now + SHORT_TTL_MS,
      rawText,
      sha256,
    });

    return {
      data: parsed,
      snapshot: createSnapshotRecord({
        provider: input.provider,
        seriesId: input.seriesId,
        requestUrl: input.url,
        rawJson: rawText,
      }),
    };
  } catch (error) {
    if (error instanceof DataUnavailableError) {
      throw error;
    }
    const msg =
      error instanceof Error ? redactSecrets(error.message) : "Network error";
    throw new DataUnavailableError(input.provider, msg);
  } finally {
    clearTimeout(timer);
  }
}
