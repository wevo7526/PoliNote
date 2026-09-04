import { NextResponse } from "next/server";
import { createRun, listRuns } from "@/lib/db/runs";
import { getSessionUserId } from "@/lib/session";

export const runtime = "nodejs";

function publicError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/\s+/g, " ").trim().slice(0, 280) || "Could not open a run.";
}

export async function GET() {
  try {
    const userId = await getSessionUserId();
    const runs = await listRuns(userId);
    return NextResponse.json({ runs });
  } catch (error) {
    const message = publicError(error);
    console.error("[polinote/runs] list failed", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST() {
  try {
    const userId = await getSessionUserId();
    const run = await createRun(userId);
    return NextResponse.json({ run }, { status: 201 });
  } catch (error) {
    const message = publicError(error);
    console.error("[polinote/runs] create failed", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
