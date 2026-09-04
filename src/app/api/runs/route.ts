import { NextResponse } from "next/server";
import { createRun, listRuns } from "@/lib/db/runs";
import { getSessionUserId } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  const userId = await getSessionUserId();
  const runs = await listRuns(userId);
  return NextResponse.json({ runs });
}

export async function POST() {
  const userId = await getSessionUserId();
  const run = await createRun(userId);
  return NextResponse.json({ run }, { status: 201 });
}
