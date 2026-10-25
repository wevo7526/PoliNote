import { readFile, unlink, writeFile } from "node:fs/promises";
import { BlobNotFoundError, get, put } from "@vercel/blob";
import { redactSecrets } from "@/lib/mcp/http";
import { isUserId } from "@/lib/session";

const ACCESS = "private" as const;
let blobTokenInvalid = false;

export function userDbBlobKey(userId: string): string {
  if (!isUserId(userId)) {
    throw new Error("Invalid user id");
  }
  return `users/${userId}.duckdb`;
}

export function userJsonBlobKey(userId: string): string {
  if (!isUserId(userId)) {
    throw new Error("Invalid user id");
  }
  return `users/${userId}.json`;
}

export function blobPersistenceEnabled(): boolean {
  return !blobTokenInvalid && Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

export async function hydrateUserDbFile(
  userId: string,
  filePath: string,
): Promise<boolean> {
  if (!blobPersistenceEnabled()) return false;
  try {
    const result = await get(userDbBlobKey(userId), {
      access: ACCESS,
      useCache: false,
    });
    if (!result || result.statusCode !== 200 || !result.stream) return false;
    const bytes = Buffer.from(await new Response(result.stream).arrayBuffer());
    if (bytes.length === 0) return false;
    await writeFile(filePath, bytes);
    await unlink(`${filePath}.wal`).catch(() => undefined);
    return true;
  } catch (error) {
    if (error instanceof BlobNotFoundError) return false;
    const msg = error instanceof Error ? error.message : String(error);
    if (/access denied|invalid token|forbidden/i.test(msg)) {
      blobTokenInvalid = true;
    }
    return false;
  }
}

export async function persistUserDbFile(
  userId: string,
  filePath: string,
): Promise<void> {
  if (!blobPersistenceEnabled()) return;
  try {
    const bytes = await readFile(filePath);
    await put(userDbBlobKey(userId), bytes, {
      access: ACCESS,
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/octet-stream",
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/access denied|invalid token|forbidden/i.test(msg)) {
      blobTokenInvalid = true;
      return;
    }
    console.warn(
      "[polinote/blob] persist duckdb skipped:",
      redactSecrets(msg),
    );
  }
}

export async function hydrateUserJsonBlob(
  userId: string,
): Promise<string | null> {
  if (!blobPersistenceEnabled()) return null;
  try {
    const result = await get(userJsonBlobKey(userId), {
      access: ACCESS,
      useCache: false,
    });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    const text = await new Response(result.stream).text();
    return text.trim() ? text : null;
  } catch (error) {
    if (error instanceof BlobNotFoundError) return null;
    return null;
  }
}

export async function persistUserJsonBlob(
  userId: string,
  jsonText: string,
): Promise<void> {
  if (!blobPersistenceEnabled()) return;
  try {
    await put(userJsonBlobKey(userId), jsonText, {
      access: ACCESS,
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
  } catch (error) {
    console.warn(
      "[polinote/blob] persist json skipped:",
      error instanceof Error ? redactSecrets(error.message) : "blob error",
    );
  }
}
