import { streamCrewTurn } from "@/lib/ai/crew";
import {
  applyCrewEvent,
  publicCrewError,
  type CrewStreamEvent,
} from "@/lib/ai/crew-events";
import { assertRunExists, getRun, persistTurn } from "@/lib/db/runs";
import { getSessionUserId } from "@/lib/session";
import type { RunSnapshot } from "@/lib/platform-types";
import type { ThreadItem } from "@/components/studio/thread-types";

export const runtime = "nodejs";
export const maxDuration = 180;
export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

function encodeSse(event: CrewStreamEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

async function persistSnapshot(userId: string, snapshot: RunSnapshot): Promise<void> {
  await persistTurn(userId, snapshot.run.id, {
    title: snapshot.run.title,
    status: snapshot.run.status,
    items: snapshot.items,
    nodes: snapshot.nodes,
    edges: snapshot.edges,
    scope: snapshot.scope,
    analyses: Object.values(snapshot.analyses),
  });
}

export async function POST(request: Request, ctx: RouteCtx) {
  const userId = await getSessionUserId();
  const { id: runId } = await ctx.params;

  if (!(await assertRunExists(userId, runId))) {
    return Response.json({ error: "Run not found" }, { status: 404 });
  }

  const body = (await request.json()) as { text?: unknown };
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return Response.json({ error: "Message required" }, { status: 400 });
  }

  const current = await getRun(userId, runId);
  if (!current) {
    return Response.json({ error: "Run not found" }, { status: 404 });
  }

  const userItem: Extract<ThreadItem, { kind: "user" }> = {
    id: crypto.randomUUID(),
    kind: "user",
    text,
  };

  const originalQuestion =
    current.scope?.question ??
    current.items.find((item) => item.kind === "user")?.text ??
    text;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: CrewStreamEvent) => {
        controller.enqueue(encodeSse(event));
      };

      let snapshot: RunSnapshot = applyCrewEvent(
        {
          ...current,
          run: { ...current.run, status: "running" },
        },
        { type: "user", item: userItem },
      );

      try {
        send({ type: "user", item: userItem });
        await persistSnapshot(userId, snapshot);

        let lastPersist: "scope" | "node" | null = null;
        for await (const event of streamCrewTurn({
          runId,
          question: originalQuestion,
          latestMessage: text,
          prior: {
            scope: current.scope,
            nodeTitles: current.nodes.map((node) => node.title),
          },
        })) {
          snapshot = applyCrewEvent(snapshot, event);
          send(event);
          if (event.type === "scope" && lastPersist !== "scope") {
            lastPersist = "scope";
            await persistSnapshot(userId, snapshot);
          }
        }

        snapshot = {
          ...snapshot,
          run: { ...snapshot.run, status: "ready" },
        };
        await persistSnapshot(userId, snapshot);
      } catch (error) {
        const message = publicCrewError(error);
        console.error("[polinote/messages]", message);
        const fail = applyCrewEvent(snapshot, { type: "error", message });
        send({ type: "error", message });
        try {
          await persistSnapshot(userId, fail);
        } catch (persistError) {
          console.error(
            "[polinote/messages] persist failed",
            persistError instanceof Error ? persistError.message : persistError,
          );
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
