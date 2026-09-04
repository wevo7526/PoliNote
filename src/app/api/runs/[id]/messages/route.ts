import { streamCrewTurn } from "@/lib/ai/crew";
import {
  applyCrewEvent,
  publicCrewError,
  type CrewStreamEvent,
} from "@/lib/ai/crew-events";
import { draftsFromCrewEvent } from "@/lib/ai/run-log";
import { appendRunEvent } from "@/lib/db/events";
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
    draft: snapshot.draft,
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
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      const send = (event: CrewStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encodeSse(event));
        } catch {
          closed = true;
        }
      };

      request.signal.addEventListener("abort", () => {
        closed = true;
      });

      let snapshot: RunSnapshot = applyCrewEvent(
        {
          ...current,
          events: current.events ?? [],
          run: { ...current.run, status: "running" },
        },
        { type: "user", item: userItem },
      );

      const persistSafe = async (next: RunSnapshot) => {
        try {
          await persistSnapshot(userId, next);
        } catch (persistError) {
          console.error(
            "[polinote/messages] persist failed",
            persistError instanceof Error ? persistError.message : persistError,
          );
        }
      };

      const seenNarration = new Set<string>();
      const knownNodes = new Set(snapshot.nodes.map((node) => node.id));
      const emitLogs = async (event: CrewStreamEvent) => {
        for (const draft of draftsFromCrewEvent(event, seenNarration, knownNodes)) {
          const logged = await appendRunEvent(userId, runId, draft);
          snapshot = applyCrewEvent(snapshot, { type: "log", event: logged });
          send({ type: "log", event: logged });
          if (event.type === "node") knownNodes.add(event.node.id);
        }
      };

      try {
        send({ type: "user", item: userItem });
        const started = await appendRunEvent(userId, runId, {
          type: "run.started",
          payload: { question: originalQuestion },
        });
        snapshot = applyCrewEvent(snapshot, { type: "log", event: started });
        send({ type: "log", event: started });
        await persistSafe(snapshot);

        let lastPersist: "scope" | "graph" | "spans" | "draft" | null = null;
        for await (const event of streamCrewTurn({
          runId,
          userId,
          question: originalQuestion,
          latestMessage: text,
          prior: {
            scope: current.scope,
            nodes: current.nodes,
            nodeTitles: current.nodes.map((node) => node.title),
            nodeKeys: current.nodes.map((node) =>
              node.id.startsWith(`${runId}_`)
                ? node.id.slice(runId.length + 1)
                : node.id,
            ),
          },
        })) {
          snapshot = applyCrewEvent(snapshot, event);
          send(event);
          await emitLogs(event);
          if (event.type === "scope" && lastPersist !== "scope") {
            lastPersist = "scope";
            await persistSafe(snapshot);
          } else if (
            (event.type === "node" || event.type === "edge") &&
            lastPersist !== "graph"
          ) {
            lastPersist = "graph";
            await persistSafe(snapshot);
          } else if (
            event.type === "node" &&
            event.node.evidenceSpanIds.length > 0 &&
            lastPersist !== "spans"
          ) {
            lastPersist = "spans";
            await persistSafe(snapshot);
          } else if (event.type === "draft") {
            lastPersist = "draft";
            await persistSafe(snapshot);
          }
        }

        snapshot = {
          ...snapshot,
          run: { ...snapshot.run, status: snapshot.nodes.length ? "ready" : snapshot.run.status },
        };
        await persistSafe(snapshot);
      } catch (error) {
        const aborted =
          request.signal.aborted ||
          /already closed|aborted/i.test(
            error instanceof Error ? error.message : String(error),
          );
        if (aborted) {
          await persistSafe({
            ...snapshot,
            run: {
              ...snapshot.run,
              status: snapshot.nodes.length ? "ready" : "failed",
            },
          });
        } else {
          const message = publicCrewError(error);
          console.error("[polinote/messages]", message);
          const fail = applyCrewEvent(snapshot, { type: "error", message });
          send({ type: "error", message });
          await persistSafe(fail);
        }
      } finally {
        close();
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
