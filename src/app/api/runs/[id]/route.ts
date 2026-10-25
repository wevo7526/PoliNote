import { NextResponse } from "next/server";
import { deleteRun, getRun } from "@/lib/db/runs";
import { toTypedApiError } from "@/lib/env";
import { getSessionUserId } from "@/lib/session";

export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: RouteCtx) {
  try {
    const userId = await getSessionUserId();
    const { id } = await ctx.params;
    const snapshot = await getRun(userId, id);
    if (!snapshot) {
      return NextResponse.json(
        {
          error: "Run not found",
          errorDetail: {
            code: "NOT_FOUND",
            service: "runs",
            message: "Run not found",
            retryable: false,
          },
        },
        { status: 404 },
      );
    }
    return NextResponse.json(snapshot);
  } catch (error) {
    const typed = toTypedApiError(error, "runs");
    console.error("[polinote/runs] get failed", typed.code, typed.message);
    return NextResponse.json(
      { error: typed.message, errorDetail: typed },
      { status: typed.status },
    );
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
    const typed = toTypedApiError(error, "runs");
    console.error("[polinote/runs] delete failed", typed.code, typed.message);
    return NextResponse.json(
      { error: typed.message, errorDetail: typed },
      { status: typed.status },
    );
  }
}
