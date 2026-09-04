import { NextResponse } from "next/server";
import { runCrewTurn } from "@/lib/ai/crew";
import { assertRunExists, getRun, persistTurn } from "@/lib/db/runs";
import { getSessionUserId } from "@/lib/session";
import type { ThreadItem } from "@/components/studio/thread-types";

export const runtime = "nodejs";
export const maxDuration = 60;

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: RouteCtx) {
  const userId = await getSessionUserId();
  const { id: runId } = await ctx.params;

  if (!(await assertRunExists(userId, runId))) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const body = (await request.json()) as { text?: unknown };
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "Message required" }, { status: 400 });
  }

  const current = await getRun(userId, runId);
  if (!current) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const userItem: ThreadItem = {
    id: crypto.randomUUID(),
    kind: "user",
    text,
  };
  const workingItems = [...current.items, userItem];

  try {
    const originalQuestion =
      current.scope?.question ??
      current.items.find((item) => item.kind === "user")?.text ??
      text;

    const turn = await runCrewTurn({
      runId,
      question: originalQuestion,
      latestMessage: text,
      prior: {
        scope: current.scope,
        nodeTitles: current.nodes.map((node) => node.title),
      },
    });

    const items: ThreadItem[] = [
      ...workingItems,
      ...turn.narrations.map((narration) => ({
        id: crypto.randomUUID(),
        kind: "narration" as const,
        agent: narration.agent,
        text: narration.text,
      })),
      {
        id: crypto.randomUUID(),
        kind: "scope" as const,
        contract: turn.scope,
      },
      ...turn.nodes.map((node) => ({
        id: crypto.randomUUID(),
        kind: "node" as const,
        node,
      })),
    ];

    await persistTurn(userId, runId, {
      title: turn.runTitle,
      status: "ready",
      items,
      nodes: turn.nodes,
      edges: turn.edges,
      scope: turn.scope,
      analyses: turn.analyses,
    });

    const snapshot = await getRun(userId, runId);
    return NextResponse.json(snapshot);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Crew turn failed";
    const items: ThreadItem[] = [
      ...workingItems,
      {
        id: crypto.randomUUID(),
        kind: "status",
        text: message.includes("OPENAI_API_KEY")
          ? "OpenAI is not configured on the server."
          : "The crew could not finish this turn. Try again.",
      },
    ];
    await persistTurn(userId, runId, {
      title: current.run.title,
      status: "failed",
      items,
      nodes: current.nodes,
      edges: current.edges,
      scope: current.scope,
      analyses: Object.values(current.analyses),
    });
    const snapshot = await getRun(userId, runId);
    return NextResponse.json(snapshot, { status: 502 });
  }
}
