import { readFile, unlink, writeFile } from "node:fs/promises";
import { BlobNotFoundError, get, put } from "@vercel/blob";
import { isUserId } from "@/lib/session";

const ACCESS = "private" as const;

export function userDbBlobKey(userId: string): string {
  if (!isUserId(userId)) {
    throw new Error("Invalid user id");
  }
  return `users/${userId}.duckdb`;
}

export function blobPersistenceEnabled(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL);
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
    throw error;
  }
}

export async function persistUserDbFile(
  userId: string,
  filePath: string,
): Promise<void> {
  if (!blobPersistenceEnabled()) return;
  const bytes = await readFile(filePath);
  await put(userDbBlobKey(userId), bytes, {
    access: ACCESS,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/octet-stream",
  });
}
