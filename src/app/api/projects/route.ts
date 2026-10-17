import { NextResponse } from "next/server";
import { createProject, listProjects } from "@/lib/db/projects";
import { listRuns } from "@/lib/db/runs";
import { getSessionUserId } from "@/lib/session";

export const runtime = "nodejs";

function publicError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/\s+/g, " ").trim().slice(0, 280) || "Project request failed.";
}

export async function GET() {
  try {
    const userId = await getSessionUserId();
    const [projects, runs] = await Promise.all([
      listProjects(userId),
      listRuns(userId),
    ]);
    return NextResponse.json({ projects, runs });
  } catch (error) {
    const message = publicError(error);
    console.error("[polinote/projects] list failed", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const userId = await getSessionUserId();
    const body = (await request.json().catch(() => null)) as {
      title?: unknown;
      description?: unknown;
      contextMemo?: unknown;
    } | null;
    const project = await createProject(userId, {
      title: typeof body?.title === "string" ? body.title : undefined,
      description: typeof body?.description === "string" ? body.description : undefined,
      contextMemo: typeof body?.contextMemo === "string" ? body.contextMemo : undefined,
    });
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    const message = publicError(error);
    console.error("[polinote/projects] create failed", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
