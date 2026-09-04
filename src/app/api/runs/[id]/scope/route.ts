import { NextResponse } from "next/server";
import { assertRunExists, persistScope } from "@/lib/db/runs";
import { getSessionUserId } from "@/lib/session";
import { ScopeContractSchema } from "@/schemas/scope-contract";

export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function PUT(request: Request, ctx: RouteCtx) {
  const userId = await getSessionUserId();
  const { id: runId } = await ctx.params;
  const body = await request.json();
  if (!(await assertRunExists(userId, runId))) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  const parsed = ScopeContractSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid scope contract" }, { status: 400 });
  }
  const snapshot = await persistScope(userId, runId, parsed.data);
  if (!snapshot) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  return NextResponse.json(snapshot);
}
