import { listEvents } from "@/lib/db/events";
import { assertRunExists } from "@/lib/db/runs";
import { getSessionUserId } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: RouteCtx) {
  const userId = await getSessionUserId();
  const { id: runId } = await ctx.params;
  if (!(await assertRunExists(userId, runId))) {
    return Response.json({ error: "Run not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const after = Number(url.searchParams.get("after") ?? "-1");
  const afterSeq = Number.isFinite(after) ? after : -1;
  const stream =
    url.searchParams.get("stream") === "1" ||
    (request.headers.get("accept") ?? "").includes("text/event-stream");

  if (!stream) {
    const events = await listEvents(userId, runId, afterSeq);
    return Response.json({ events });
  }

  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      let cursor = afterSeq;
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
      request.signal.addEventListener("abort", close);

      const pump = async () => {
        const events = await listEvents(userId, runId, cursor);
        for (const event of events) {
          if (closed) return;
          cursor = event.seq;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
      };

      try {
        await pump();
        let idle = 0;
        while (!closed && idle < 45) {
          await new Promise((resolve) => setTimeout(resolve, 800));
          const before = cursor;
          await pump();
          idle = cursor === before ? idle + 1 : 0;
        }
      } catch (error) {
        console.error(
          "[polinote/events]",
          error instanceof Error ? error.message : error,
        );
      } finally {
        close();
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
