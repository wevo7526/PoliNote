import { z } from "zod";
import { redactSecrets } from "@/lib/mcp/http";
import { SessionConfigError, SessionForbiddenError } from "@/lib/session";

export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z
    .string()
    .trim()
    .refine(
      (val) => !val || /^postgres(?:ql)?:\/\//i.test(val),
      "DATABASE_URL must be a valid postgres:// or postgresql:// URI",
    )
    .optional(),
  OPENAI_API_KEY: z.string().trim().optional(),
  AI_GATEWAY_API_KEY: z.string().trim().optional(),
  VERCEL_OIDC_TOKEN: z.string().trim().optional(),
  OPENAI_MODEL: z.string().trim().optional(),
  SKEPTIC_MODEL: z.string().trim().optional(),
  FRED_API_KEY: z.string().trim().optional(),
  BEA_API_KEY: z.string().trim().optional(),
  BLS_API_KEY: z.string().trim().optional(),
  CENSUS_API_KEY: z.string().trim().optional(),
  CONGRESS_API_KEY: z.string().trim().optional(),
  FIRECRAWL_API_KEY: z.string().trim().optional(),
  BLOB_READ_WRITE_TOKEN: z.string().trim().optional(),
  SESSION_SECRET: z
    .string()
    .trim()
    .refine(
      (val) => !val || val.length >= 16,
      "SESSION_SECRET must be at least 16 characters when provided",
    )
    .optional(),
  PYTHON_ECONOMETRICS_URL: z.string().trim().url().optional(),
});

export type ValidatedEnv = z.infer<typeof EnvSchema>;

export type HealthWarningItem = {
  key: string;
  severity: "critical" | "warning" | "optional";
  message: string;
};

export type EnvValidationSummary = {
  valid: boolean;
  issues: Array<{ path: string; message: string }>;
  warnings: HealthWarningItem[];
  configured: {
    databaseUrl: boolean;
    openai: boolean;
    fred: boolean;
    bea: boolean;
    bls: boolean;
    census: boolean;
    congress: boolean;
    firecrawl: boolean;
    blob: boolean;
    sessionSecret: boolean;
    pythonServiceUrl: boolean;
  };
};

let cachedSummary: EnvValidationSummary | null = null;

export function validateStartupEnv(
  rawEnv: NodeJS.ProcessEnv = process.env,
): EnvValidationSummary {
  const clean: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(rawEnv)) {
    const trimmed = typeof v === "string" ? v.trim() : undefined;
    clean[k] = trimmed === "" ? undefined : trimmed;
  }

  const parsed = EnvSchema.safeParse(clean);
  const issues = parsed.success
    ? []
    : parsed.error.issues.map((issue) => ({
        path: issue.path.join(".") || "env",
        message: issue.message,
      }));

  const configured = {
    databaseUrl: Boolean(clean.DATABASE_URL),
    openai: Boolean(
      clean.OPENAI_API_KEY ||
        clean.AI_GATEWAY_API_KEY ||
        clean.VERCEL_OIDC_TOKEN,
    ),
    fred: Boolean(clean.FRED_API_KEY),
    bea: Boolean(clean.BEA_API_KEY),
    bls: Boolean(clean.BLS_API_KEY),
    census: Boolean(clean.CENSUS_API_KEY),
    congress: Boolean(clean.CONGRESS_API_KEY),
    firecrawl: Boolean(clean.FIRECRAWL_API_KEY),
    blob: Boolean(clean.BLOB_READ_WRITE_TOKEN),
    sessionSecret: Boolean(
      clean.SESSION_SECRET && clean.SESSION_SECRET.length >= 16,
    ),
    pythonServiceUrl: Boolean(clean.PYTHON_ECONOMETRICS_URL),
  };

  if (clean.NODE_ENV === "production" && !configured.sessionSecret) {
    issues.push({
      path: "SESSION_SECRET",
      message:
        "SESSION_SECRET (>= 16 characters) is required in production (server fails closed without it).",
    });
  }

  const warnings: HealthWarningItem[] = [];
  if (!configured.sessionSecret) {
    warnings.push({
      key: "SESSION_SECRET",
      severity: clean.NODE_ENV === "production" ? "critical" : "warning",
      message:
        clean.NODE_ENV === "production"
          ? "SESSION_SECRET is missing (production fails closed without a 16+ char secret)."
          : "SESSION_SECRET is not set in environment (using local dev secret; required in production).",
    });
  }
  if (!configured.fred) {
    warnings.push({
      key: "FRED_API_KEY",
      severity: "critical",
      message:
        "FRED_API_KEY is not set — live FRED/ALFRED series pulls will fail visibly and mark dependent claims unverifiable.",
    });
  }
  if (!configured.openai) {
    warnings.push({
      key: "OPENAI_API_KEY",
      severity: "critical",
      message:
        "No LLM credential configured (set OPENAI_API_KEY or AI_GATEWAY_API_KEY / VERCEL_OIDC_TOKEN).",
    });
  }

  const optionalMissing: string[] = [];
  if (!configured.bea) optionalMissing.push("BEA_API_KEY");
  if (!configured.bls) optionalMissing.push("BLS_API_KEY");
  if (!configured.census) optionalMissing.push("CENSUS_API_KEY");
  if (!configured.congress) optionalMissing.push("CONGRESS_API_KEY");
  if (!configured.databaseUrl) optionalMissing.push("DATABASE_URL");
  if (!configured.pythonServiceUrl) optionalMissing.push("PYTHON_ECONOMETRICS_URL");

  if (optionalMissing.length > 0) {
    warnings.push({
      key: "OPTIONAL_PROVIDERS",
      severity: "optional",
      message: `Optional keys/services not configured: ${optionalMissing.join(", ")}.`,
    });
  }

  cachedSummary = {
    valid: parsed.success && issues.length === 0,
    issues,
    warnings,
    configured,
  };
  return cachedSummary;
}

export function getEnvSummary(): EnvValidationSummary {
  return cachedSummary ?? validateStartupEnv();
}

export type TypedApiError = {
  code:
    | "WORKSPACE_ACCESS_FORBIDDEN"
    | "SESSION_SECRET_MISSING"
    | "UPSTREAM_NETWORK_ERROR"
    | "DATABASE_CONNECTION_ERROR"
    | "DATA_UNAVAILABLE"
    | "VALIDATION_ERROR"
    | "NOT_FOUND"
    | "RATE_LIMITED"
    | "INTERNAL_ERROR";
  status: number;
  service: string;
  message: string;
  retryable: boolean;
};

/**
 * Normalizes any thrown error into a structured TypedApiError.
 * Guarantees we never return a bare "fetch failed" string to the client,
 * and preserves 403/503 status codes for session security errors.
 */
export function toTypedApiError(
  error: unknown,
  service = "platform",
): TypedApiError {
  if (error instanceof SessionForbiddenError) {
    return {
      code: "WORKSPACE_ACCESS_FORBIDDEN",
      status: 403,
      service: "session",
      message: error.message,
      retryable: false,
    };
  }

  if (error instanceof SessionConfigError) {
    return {
      code: "SESSION_SECRET_MISSING",
      status: 503,
      service: "session",
      message: error.message,
      retryable: false,
    };
  }

  const rawMessage =
    error instanceof Error ? error.message : String(error ?? "Unknown error");
  const causeMessage =
    error instanceof Error && error.cause instanceof Error
      ? error.cause.message
      : "";
  const combined = redactSecrets(
    [rawMessage, causeMessage].filter(Boolean).join(" — "),
  )
    .replace(/\s+/g, " ")
    .trim();

  if (/^fetch failed$/i.test(rawMessage.trim()) || /fetch failed/i.test(combined)) {
    const detail = causeMessage
      ? ` (${redactSecrets(causeMessage)})`
      : " (network connection to upstream endpoint failed or timed out)";
    return {
      code:
        service === "database" || service === "neon"
          ? "DATABASE_CONNECTION_ERROR"
          : "UPSTREAM_NETWORK_ERROR",
      status: 502,
      service,
      message: `Upstream ${service} request could not complete${detail}. Verify network reachability and service credentials.`,
      retryable: true,
    };
  }

  if (/DATABASE_URL|neon|postgres|connection refused|ECONNREFUSED/i.test(combined)) {
    return {
      code: "DATABASE_CONNECTION_ERROR",
      status: 503,
      service: "database",
      message: `Database connection error (${service}): ${combined.slice(0, 240)}`,
      retryable: true,
    };
  }

  if (/Data unavailable:/i.test(combined)) {
    return {
      code: "DATA_UNAVAILABLE",
      status: 503,
      service,
      message: combined.slice(0, 320),
      retryable: false,
    };
  }

  if (/429|rate limit/i.test(combined)) {
    return {
      code: "RATE_LIMITED",
      status: 429,
      service,
      message: `Rate limit reached for ${service}: ${combined.slice(0, 240)}`,
      retryable: true,
    };
  }

  return {
    code: "INTERNAL_ERROR",
    status: 500,
    service,
    message:
      combined.slice(0, 280) ||
      `Unexpected error in ${service}. Check /api/health for diagnostics.`,
    retryable: false,
  };
}
