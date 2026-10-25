import { NextResponse } from "next/server";
import { createProject, listProjects } from "@/lib/db/projects";
import { listRuns } from "@/lib/db/runs";
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
    const typed = toTypedApiError(error, "projects");
    console.error("[polinote/projects] list failed", typed.code, typed.message);
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
      title?: unknown;
      description?: unknown;
      contextMemo?: unknown;
    } | null;
    const project = await createProject(userId, {
      id: typeof body?.id === "string" ? body.id : undefined,
      title: typeof body?.title === "string" ? body.title : undefined,
      description: typeof body?.description === "string" ? body.description : undefined,
      contextMemo: typeof body?.contextMemo === "string" ? body.contextMemo : undefined,
    });
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    const typed = toTypedApiError(error, "projects");
    console.error("[polinote/projects] create failed", typed.code, typed.message);
    return NextResponse.json(
      { error: typed.message, errorDetail: typed },
      { status: typed.status },
    );
  }
}
