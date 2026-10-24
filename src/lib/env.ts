import { z } from "zod";
import { redactSecrets } from "@/lib/mcp/http";

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

export type EnvValidationSummary = {
  valid: boolean;
  issues: Array<{ path: string; message: string }>;
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

  cachedSummary = {
    valid: parsed.success,
    issues,
    configured,
  };
  return cachedSummary;
}

export function getEnvSummary(): EnvValidationSummary {
  return cachedSummary ?? validateStartupEnv();
}

export type TypedApiError = {
  code:
    | "UPSTREAM_NETWORK_ERROR"
    | "DATABASE_CONNECTION_ERROR"
    | "DATA_UNAVAILABLE"
    | "VALIDATION_ERROR"
    | "NOT_FOUND"
    | "RATE_LIMITED"
    | "INTERNAL_ERROR";
  service: string;
  message: string;
  retryable: boolean;
};

/**
 * Normalizes any thrown error into a structured TypedApiError.
 * Guarantees we never return a bare "fetch failed" string to the client.
 */
export function toTypedApiError(
  error: unknown,
  service = "platform",
): TypedApiError {
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
      service,
      message: `Upstream ${service} request could not complete${detail}. Verify network reachability and service credentials.`,
      retryable: true,
    };
  }

  if (/DATABASE_URL|neon|postgres|connection refused|ECONNREFUSED/i.test(combined)) {
    return {
      code: "DATABASE_CONNECTION_ERROR",
      service: "database",
      message: `Database connection error (${service}): ${combined.slice(0, 240)}`,
      retryable: true,
    };
  }

  if (/Data unavailable:/i.test(combined)) {
    return {
      code: "DATA_UNAVAILABLE",
      service,
      message: combined.slice(0, 320),
      retryable: false,
    };
  }

  if (/429|rate limit/i.test(combined)) {
    return {
      code: "RATE_LIMITED",
      service,
      message: `Rate limit reached for ${service}: ${combined.slice(0, 240)}`,
      retryable: true,
    };
  }

  return {
    code: "INTERNAL_ERROR",
    service,
    message:
      combined.slice(0, 280) ||
      `Unexpected error in ${service}. Check /api/health for diagnostics.`,
    retryable: false,
  };
}
