import {
  streamSandboxTurn,
  type SandboxStreamEvent,
} from "@/lib/ai/sandbox";
import { getSessionUserId } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

function encodeSse(event: SandboxStreamEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

export async function POST(request: Request) {
  await getSessionUserId();
  const body = (await request.json().catch(() => null)) as {
    prompt?: unknown;
    personaId?: unknown;
  } | null;

  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  const personaId =
    typeof body?.personaId === "string" ? body.personaId.trim() : "auto";

  if (!prompt) {
    return Response.json({ error: "Prompt is required" }, { status: 400 });
  }

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

      const send = (event: SandboxStreamEvent) => {
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

      try {
        for await (const event of streamSandboxTurn({ prompt, personaId })) {
          send(event);
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Sandbox turn failed.";
        send({ type: "error", message });
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
