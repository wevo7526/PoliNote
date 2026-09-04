import { NextResponse } from "next/server";
import { deleteRun, getRun } from "@/lib/db/runs";
import { getSessionUserId } from "@/lib/session";

export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

function publicError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/\s+/g, " ").trim().slice(0, 280) || "Run request failed.";
}

export async function GET(_request: Request, ctx: RouteCtx) {
  try {
    const userId = await getSessionUserId();
    const { id } = await ctx.params;
    const snapshot = await getRun(userId, id);
    if (!snapshot) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }
    return NextResponse.json(snapshot);
  } catch (error) {
    const message = publicError(error);
    console.error("[polinote/runs] get failed", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: Request, ctx: RouteCtx) {
  try {
    const userId = await getSessionUserId();
    const { id } = await ctx.params;
    const deleted = await deleteRun(userId, id);
    if (!deleted) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = publicError(error);
    console.error("[polinote/runs] delete failed", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
