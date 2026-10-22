import { NextResponse } from "next/server";
import { listProjects } from "@/lib/db/projects";
import { createRun, listRuns } from "@/lib/db/runs";
import { redactSecrets } from "@/lib/mcp/http";
import { getSessionUserId } from "@/lib/session";

export const runtime = "nodejs";

function publicError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return redactSecrets(raw).replace(/\s+/g, " ").trim().slice(0, 280) || "Could not open a run.";
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
    console.error("[polinote/runs] list failed", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const userId = await getSessionUserId();
    const body = (await request.json().catch(() => null)) as {
      projectId?: unknown;
      title?: unknown;
    } | null;
    const projectId =
      typeof body?.projectId === "string" ? body.projectId.trim() : undefined;
    const title =
      typeof body?.title === "string" ? body.title.trim() : undefined;
    const run = await createRun(userId, { projectId, title });
    return NextResponse.json({ run }, { status: 201 });
  } catch (error) {
    const message = publicError(error);
    console.error("[polinote/runs] create failed", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
