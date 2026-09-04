import { NextResponse } from "next/server";
import { deleteRun, getRun } from "@/lib/db/runs";
import { getSessionUserId } from "@/lib/session";

export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: RouteCtx) {
  const userId = await getSessionUserId();
  const { id } = await ctx.params;
  const snapshot = await getRun(userId, id);
  if (!snapshot) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  return NextResponse.json(snapshot);
}

export async function DELETE(_request: Request, ctx: RouteCtx) {
  const userId = await getSessionUserId();
  const { id } = await ctx.params;
  const deleted = await deleteRun(userId, id);
  if (!deleted) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
