import { NextResponse } from "next/server";
import { createProject, listProjects } from "@/lib/db/projects";
import { createRun, listRuns } from "@/lib/db/runs";
import { toTypedApiError } from "@/lib/env";
import { getSessionUserId } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  try {
    const userId = await getSessionUserId();
    const projects = await listProjects(userId);
    const runs = await listRuns(userId);
    return NextResponse.json({ projects, runs });
  } catch (error) {
    const typed = toTypedApiError(error, "runs");
    console.error("[polinote/runs] list failed", typed.code, typed.message);
    return NextResponse.json(
      { error: typed.message, errorDetail: typed },
      { status: typed.status },
    );
  }
}

export async function POST(request: Request) {
  try {
    const userId = await getSessionUserId();
    const body = (await request.json().catch(() => null)) as {
      id?: unknown;
      projectId?: unknown;
      title?: unknown;
      project?: {
        id?: unknown;
        title?: unknown;
        description?: unknown;
        contextMemo?: unknown;
      } | null;
    } | null;
    const id = typeof body?.id === "string" ? body.id.trim() : undefined;
    const projectId =
      typeof body?.projectId === "string" ? body.projectId.trim() : undefined;
    const title =
      typeof body?.title === "string" ? body.title.trim() : undefined;

    if (body?.project && typeof body.project === "object" && projectId) {
      await createProject(userId, {
        id: projectId,
        title:
          typeof body.project.title === "string" ? body.project.title : undefined,
        description:
          typeof body.project.description === "string"
            ? body.project.description
            : undefined,
        contextMemo:
          typeof body.project.contextMemo === "string"
            ? body.project.contextMemo
            : undefined,
      }).catch(() => undefined);
    }

    const run = await createRun(userId, { id, projectId, title });
    return NextResponse.json({ run }, { status: 201 });
  } catch (error) {
    const typed = toTypedApiError(error, "runs");
    console.error("[polinote/runs] create failed", typed.code, typed.message);
    return NextResponse.json(
      { error: typed.message, errorDetail: typed },
      { status: typed.status },
    );
  }
}
