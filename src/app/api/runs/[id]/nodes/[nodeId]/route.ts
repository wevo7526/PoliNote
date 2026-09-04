import { NextResponse } from "next/server";
import { assertRunExists, updateNodeStatus } from "@/lib/db/runs";
import { isUserNodeStatus } from "@/schemas/digression";
import { getSessionUserId } from "@/lib/session";

export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string; nodeId: string }> };

export async function PATCH(request: Request, ctx: RouteCtx) {
  const userId = await getSessionUserId();
  const { id: runId, nodeId } = await ctx.params;
  if (!(await assertRunExists(userId, runId))) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as { status?: unknown };
  const status = typeof body?.status === "string" ? body.status : "";
  if (status === "supported") {
    return NextResponse.json(
      { error: "Supported requires an MCP evidence span. The crew sets that." },
      { status: 400 },
    );
  }
  if (!isUserNodeStatus(status)) {
    return NextResponse.json(
      { error: "Status must be contested, pruned, or proposed." },
      { status: 400 },
    );
  }

  const snapshot = await updateNodeStatus(userId, runId, nodeId, status);
  if (!snapshot) {
    return NextResponse.json({ error: "Node not found" }, { status: 404 });
  }
  return NextResponse.json(snapshot);
}
