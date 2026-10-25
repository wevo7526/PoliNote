import { NextResponse } from "next/server";
import { deleteProject, getProject, updateProject } from "@/lib/db/projects";
import { getRun, listRuns } from "@/lib/db/runs";
import { toTypedApiError } from "@/lib/env";
import { getSessionUserId } from "@/lib/session";

export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: RouteCtx) {
  try {
    const userId = await getSessionUserId();
    const { id } = await ctx.params;
    const project = await getProject(userId, id);
    if (!project) {
      return NextResponse.json(
        {
          error: "Project not found",
          errorDetail: {
            code: "NOT_FOUND",
            service: "projects",
            message: "Project not found",
            retryable: false,
          },
        },
        { status: 404 },
      );
    }
    const allRuns = await listRuns(userId);
    const projectRuns = allRuns.filter((run) => run.projectId === id);
    const snapshots = await Promise.all(
      projectRuns.slice(0, 12).map((run) => getRun(userId, run.id)),
    );
    return NextResponse.json({
      project,
      runs: projectRuns,
      snapshots: snapshots.filter((item) => item !== null),
    });
  } catch (error) {
    const typed = toTypedApiError(error, "projects");
    console.error("[polinote/projects] get failed", typed.code, typed.message);
    return NextResponse.json(
      { error: typed.message, errorDetail: typed },
      { status: typed.status },
    );
  }
}

export async function PUT(request: Request, ctx: RouteCtx) {
  try {
    const userId = await getSessionUserId();
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => null)) as {
      title?: unknown;
      description?: unknown;
      contextMemo?: unknown;
    } | null;
    const updated = await updateProject(userId, id, {
      title: typeof body?.title === "string" ? body.title : undefined,
      description: typeof body?.description === "string" ? body.description : undefined,
      contextMemo: typeof body?.contextMemo === "string" ? body.contextMemo : undefined,
    });
    if (!updated) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    return NextResponse.json({ project: updated });
  } catch (error) {
    const typed = toTypedApiError(error, "projects");
    console.error("[polinote/projects] update failed", typed.code, typed.message);
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
    const deleted = await deleteProject(userId, id);
    if (!deleted) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const typed = toTypedApiError(error, "projects");
    console.error("[polinote/projects] delete failed", typed.code, typed.message);
    return NextResponse.json(
      { error: typed.message, errorDetail: typed },
      { status: typed.status },
    );
  }
}
