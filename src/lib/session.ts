import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { cookies, headers } from "next/headers";

export const SESSION_COOKIE_NAME = "pn_uid";
export const LEGACY_USER_HEADER = "x-polinote-user";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUserId(value: string): boolean {
  return UUID_RE.test(value);
}

export class SessionConfigError extends Error {
  readonly status = 503;
  readonly code = "SESSION_SECRET_MISSING";

  constructor(
    message = "Server configuration error: SESSION_SECRET (at least 16 characters) is required in production to issue or verify workspace sessions.",
  ) {
    super(message);
    this.name = "SessionConfigError";
  }
}

export class SessionForbiddenError extends Error {
  readonly status = 403;
  readonly code = "WORKSPACE_ACCESS_FORBIDDEN";

  constructor(
    message = "Forbidden: workspace session cookie is invalid, forged, or does not match the requested workspace ID.",
  ) {
    super(message);
    this.name = "SessionForbiddenError";
  }
}

export function signSessionUserId(userId: string, secret: string): string {
  return createHmac("sha256", secret).update(userId).digest("hex");
}

export function verifySessionMac(
  userId: string,
  mac: string,
  secret: string,
): boolean {
  if (!/^[0-9a-f]{64}$/i.test(mac)) return false;
  const expected = signSessionUserId(userId, secret);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(mac, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Resolves the session signing secret.
 * In production, fails closed if SESSION_SECRET (< 16 chars) is not configured.
 */
export async function resolveSessionSecret(options?: {
  nodeEnv?: string;
  configuredSecret?: string;
}): Promise<string> {
  const nodeEnv = options?.nodeEnv ?? process.env.NODE_ENV ?? "development";
  const configured = (
    options?.configuredSecret ??
    process.env.SESSION_SECRET ??
    ""
  ).trim();

  if (configured.length >= 16) {
    return configured;
  }

  if (nodeEnv === "production") {
    throw new SessionConfigError();
  }

  // Development / test fallback only
  const dir = path.join(process.cwd(), "data");
  const file = path.join(dir, ".session-secret");
  try {
    const existing = (await readFile(file, "utf8")).trim();
    if (existing.length >= 16) return existing;
  } catch {
    // first boot in local dev
  }

  const generated = randomBytes(32).toString("hex");
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(file, generated, { encoding: "utf8", flag: "wx" }).catch(
      () => undefined,
    );
    const again = (await readFile(file, "utf8")).trim();
    if (again.length >= 16) return again;
  } catch {
    // ignore fs error in test
  }
  return generated;
}

export type VerifiedSessionDecision = {
  userId: string;
  isNewSession: boolean;
  cookieName: string;
  cookieValue: string;
  cookieOptions: {
    httpOnly: true;
    sameSite: "lax";
    secure: boolean;
    path: "/";
    maxAge: number;
  };
};

/**
 * Pure verification & minting logic for unit testing and server execution.
 * - Rejects forged/tampered cookies with 403 (`SessionForbiddenError`).
 * - Rejects any client-sent workspace ID (`clientSuppliedId`) that does not match a valid signed cookie with 403 (`SessionForbiddenError`).
 * - In production without `SESSION_SECRET` (16+ chars), fails closed (`SessionConfigError`).
 */
export async function evaluateWorkspaceSession(input: {
  rawCookie?: string | null;
  clientSuppliedId?: string | null;
  nodeEnv?: string;
  configuredSecret?: string;
}): Promise<VerifiedSessionDecision> {
  const nodeEnv = input.nodeEnv ?? process.env.NODE_ENV ?? "development";
  const secret = await resolveSessionSecret({
    nodeEnv,
    configuredSecret: input.configuredSecret,
  });

  const rawCookie = (input.rawCookie ?? "").trim();
  const clientId = (input.clientSuppliedId ?? "").trim();

  if (rawCookie) {
    const parts = rawCookie.split(".");
    const cookieUid = parts[0] ?? "";
    const mac = parts[1] ?? "";
    if (
      parts.length !== 2 ||
      !isUserId(cookieUid) ||
      !verifySessionMac(cookieUid, mac, secret)
    ) {
      throw new SessionForbiddenError(
        "Forbidden: invalid or forged session cookie signature.",
      );
    }

    if (clientId && clientId !== cookieUid) {
      throw new SessionForbiddenError(
        "Forbidden: client-supplied workspace ID does not match the signed session cookie.",
      );
    }

    return {
      userId: cookieUid,
      isNewSession: false,
      cookieName: SESSION_COOKIE_NAME,
      cookieValue: rawCookie,
      cookieOptions: {
        httpOnly: true,
        sameSite: "lax",
        secure: nodeEnv === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      },
    };
  }

  // No signed cookie present: if the client attempted to supply an arbitrary workspace ID, reject with 403
  if (clientId) {
    throw new SessionForbiddenError(
      "Forbidden: client-supplied workspace ID is not allowed without a matching signed session cookie.",
    );
  }

  const userId = crypto.randomUUID();
  const signedValue = `${userId}.${signSessionUserId(userId, secret)}`;
  return {
    userId,
    isNewSession: true,
    cookieName: SESSION_COOKIE_NAME,
    cookieValue: signedValue,
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: nodeEnv === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    },
  };
}

export async function getSessionUserId(): Promise<string> {
  const [store, hdrs] = await Promise.all([cookies(), headers()]);
  const rawCookie = store.get(SESSION_COOKIE_NAME)?.value ?? null;
  const headerUid = hdrs.get(LEGACY_USER_HEADER) ?? null;

  const decision = await evaluateWorkspaceSession({
    rawCookie,
    clientSuppliedId: headerUid,
  });

  if (decision.isNewSession) {
    try {
      store.set(
        decision.cookieName,
        decision.cookieValue,
        decision.cookieOptions,
      );
    } catch {
      /* read-only cookie context */
    }
  }

  return decision.userId;
}
