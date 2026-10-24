type RateWindow = {
  timestamps: number[];
};

const buckets = new Map<string, RateWindow>();

export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  resetInMs: number;
};

/**
 * Sliding-window rate limiter per user/session key.
 */
export function checkRateLimit(
  key: string,
  maxRequests = 30,
  windowMs = 60_000,
): RateLimitDecision {
  const now = Date.now();
  const cutoff = now - windowMs;
  const entry = buckets.get(key) ?? { timestamps: [] };
  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

  if (entry.timestamps.length >= maxRequests) {
    const oldest = entry.timestamps[0] ?? now;
    buckets.set(key, entry);
    return {
      allowed: false,
      remaining: 0,
      resetInMs: Math.max(1000, oldest + windowMs - now),
    };
  }

  entry.timestamps.push(now);
  buckets.set(key, entry);
  return {
    allowed: true,
    remaining: Math.max(0, maxRequests - entry.timestamps.length),
    resetInMs: windowMs,
  };
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

export const CURRENT_PROMPT_VERSION = "polinote-econometrics-v2.4";
export const CURRENT_CODE_VERSION =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "local-v2";
