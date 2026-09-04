import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { cookies } from "next/headers";

const COOKIE = "pn_uid";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUserId(value: string): boolean {
  return UUID_RE.test(value);
}

async function sessionSecret(): Promise<string> {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16) {
    return process.env.SESSION_SECRET;
  }
  const dir = path.join(process.cwd(), "data");
  const file = path.join(dir, ".session-secret");
  try {
    const existing = (await readFile(file, "utf8")).trim();
    if (existing.length >= 16) return existing;
  } catch {
    // first boot
  }
  await mkdir(dir, { recursive: true });
  const generated = randomBytes(32).toString("hex");
  await writeFile(file, generated, { encoding: "utf8", flag: "wx" }).catch(
    async () => {
      // lost the race — read whatever won
    },
  );
  const again = (await readFile(file, "utf8")).trim();
  return again.length >= 16 ? again : generated;
}

function sign(userId: string, secret: string): string {
  return createHmac("sha256", secret).update(userId).digest("hex");
}

function verify(userId: string, mac: string, secret: string): boolean {
  const expected = sign(userId, secret);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(mac, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function getSessionUserId(): Promise<string> {
  const store = await cookies();
  const raw = store.get(COOKIE)?.value;
  const secret = await sessionSecret();

  if (raw) {
    const [userId, mac] = raw.split(".");
    if (userId && mac && isUserId(userId) && verify(userId, mac, secret)) {
      return userId;
    }
  }

  const userId = crypto.randomUUID();
  store.set(COOKIE, `${userId}.${sign(userId, secret)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return userId;
}
