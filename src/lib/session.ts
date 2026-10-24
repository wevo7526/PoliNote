import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { cookies, headers } from "next/headers";

const COOKIE = "pn_uid";
const USER_HEADER = "x-polinote-user";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUserId(value: string): boolean {
  return UUID_RE.test(value);
}

function isServerless(): boolean {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

function writableSecretDir(): string {
  if (isServerless()) {
    return path.join("/tmp", "polinote");
  }
  return path.join(process.cwd(), "data");
}

let warnedMissingSessionSecret = false;

async function sessionSecret(): Promise<string> {
  const configured = process.env.SESSION_SECRET?.trim();
  if (configured && configured.length >= 16) {
    return configured;
  }

  if (isServerless() && !warnedMissingSessionSecret) {
    warnedMissingSessionSecret = true;
    console.warn(
      "[polinote/session] SESSION_SECRET (>= 16 chars) is not set; using ephemeral per-instance secret",
    );
  }

  // Vercel's function FS is read-only under /var/task; write ephemeral fallback to /tmp.
  const dir = writableSecretDir();
  const file = path.join(dir, ".session-secret");
  try {
    const existing = (await readFile(file, "utf8")).trim();
    if (existing.length >= 16) return existing;
  } catch {
    // first boot
  }

  const generated = randomBytes(32).toString("hex");
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(file, generated, { encoding: "utf8", flag: "wx" }).catch(
      async () => {
        /* lost the race — read whatever won */
      },
    );
    const again = (await readFile(file, "utf8")).trim();
    if (again.length >= 16) return again;
  } catch (error) {
    console.error(
      "[polinote/session] could not persist session secret",
      error instanceof Error ? error.message : error,
    );
  }
  return generated;
}

function sign(userId: string, secret: string): string {
  return createHmac("sha256", secret).update(userId).digest("hex");
}

function verify(userId: string, mac: string, secret: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(mac)) return false;
  const expected = sign(userId, secret);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(mac, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function getSessionUserId(): Promise<string> {
  const [store, hdrs, secret] = await Promise.all([
    cookies(),
    headers(),
    sessionSecret(),
  ]);

  const headerUid = hdrs.get(USER_HEADER)?.trim() ?? "";
  const rawCookie = store.get(COOKIE)?.value?.trim() ?? "";
  const [cookieUid, mac] = rawCookie.split(".");

  if (cookieUid && mac && isUserId(cookieUid) && verify(cookieUid, mac, secret)) {
    return cookieUid;
  }

  // Accountless localization: preserve a valid client-supplied or previously-minted
  // UUID across cold starts or secret rotations, then re-sign the session cookie.
  const resolvedId =
    (headerUid && isUserId(headerUid) ? headerUid : null) ??
    (cookieUid && isUserId(cookieUid) ? cookieUid : null) ??
    crypto.randomUUID();

  try {
    store.set(COOKIE, `${resolvedId}.${sign(resolvedId, secret)}`, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  } catch {
    /* cookies may be read-only in some contexts */
  }
  return resolvedId;
}
