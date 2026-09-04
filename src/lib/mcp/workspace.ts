import { queryRows, withUserDb } from "@/lib/db/user-store";
import { isUserId } from "@/lib/session";
import { resultHash, spanId } from "@/lib/mcp/hash";
import type { EvidenceSpan } from "@/schemas/span";
import type { ToolResult } from "@/tools/registry";

function ctx(args: Record<string, unknown>): { userId: string; runId: string } | null {
  const userId = typeof args.userId === "string" ? args.userId : "";
  const runId = typeof args.runId === "string" ? args.runId : "";
  if (!isUserId(userId) || !runId) return null;
  return { userId, runId };
}

export async function readMemo(
  args: Record<string, unknown>,
): Promise<ToolResult<{ body: string; span: EvidenceSpan }>> {
  const session = ctx(args);
  if (!session) return { ok: false, error: "userId and runId required" };
  const rows = await withUserDb(session.userId, async (connection) => {
    const found = await queryRows<{ body: string }>(
      connection,
      `SELECT body FROM memos WHERE run_id = $run_id`,
      { run_id: session.runId },
    );
    return found;
  });
  const body = rows[0]?.body ?? "";
  const hash = resultHash({ runId: session.runId, body });
  const span: EvidenceSpan = {
    id: spanId("workspace", "read_memo", hash),
    server: "workspace",
    tool: "workspace.read_memo",
    citation: body ? "Workspace memo" : "Workspace memo is empty",
    resultHash: hash,
  };
  return { ok: true, data: { body, span }, spanId: span.id };
}

export async function writeMemo(
  args: Record<string, unknown>,
): Promise<ToolResult<{ body: string; span: EvidenceSpan }>> {
  const session = ctx(args);
  if (!session) return { ok: false, error: "userId and runId required" };
  const body = typeof args.body === "string" ? args.body : "";
  if (!body.trim()) return { ok: false, error: "body required" };
  const ts = new Date().toISOString();
  await withUserDb(session.userId, async (connection) => {
    await connection.run(
      `INSERT OR REPLACE INTO memos (run_id, body, updated_at)
       VALUES ($run_id, $body, $updated_at)`,
      { run_id: session.runId, body, updated_at: ts },
    );
  });
  const hash = resultHash({ runId: session.runId, body });
  const span: EvidenceSpan = {
    id: spanId("workspace", "write_memo", hash),
    server: "workspace",
    tool: "workspace.write_memo",
    citation: "Workspace memo written",
    resultHash: hash,
  };
  return { ok: true, data: { body, span }, spanId: span.id };
}
