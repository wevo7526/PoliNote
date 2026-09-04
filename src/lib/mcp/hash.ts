import { createHash } from "node:crypto";

export function resultHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 16);
}

export function spanId(server: string, tool: string, hash: string): string {
  return `${server}:${tool}:${hash}`;
}
