import { applyRunEvent } from "@/lib/ai/run-log";
import { listEvents } from "@/lib/db/events";
import { getRun } from "@/lib/db/runs";
import type { RunSnapshot } from "@/lib/platform-types";
import { resultHash, spanId } from "@/lib/mcp/hash";
import { isUserId } from "@/lib/session";
import type { EvidenceSpan } from "@/schemas/span";
import type { ToolResult } from "@/tools/registry";

function ctx(args: Record<string, unknown>): { userId: string; runId: string } | null {
  const userId = typeof args.userId === "string" ? args.userId : "";
  const runId = typeof args.runId === "string" ? args.runId : "";
  if (!isUserId(userId) || !runId) return null;
  return { userId, runId };
}

export async function getRunTrace(
  args: Record<string, unknown>,
): Promise<
  ToolResult<{
    eventCount: number;
    lastSeq: number;
    types: string[];
    span: EvidenceSpan;
  }>
> {
  const session = ctx(args);
  if (!session) return { ok: false, error: "userId and runId required" };
  const events = await listEvents(session.userId, session.runId);
  const types = [...new Set(events.map((event) => event.type))];
  const lastSeq = events.at(-1)?.seq ?? -1;
  const hash = resultHash({ count: events.length, lastSeq, types });
  const span: EvidenceSpan = {
    id: spanId("trace", "get_run", hash),
    server: "trace",
    tool: "trace.get_run",
    citation: `${events.length} logged events`,
    resultHash: hash,
  };
  return {
    ok: true,
    data: { eventCount: events.length, lastSeq, types, span },
    spanId: span.id,
  };
}

export async function getSpan(
  args: Record<string, unknown>,
): Promise<ToolResult<{ found: boolean; type?: string; seq?: number; span: EvidenceSpan }>> {
  const session = ctx(args);
  if (!session) return { ok: false, error: "userId and runId required" };
  const look = typeof args.spanId === "string" ? args.spanId : "";
  if (!look) return { ok: false, error: "spanId required" };
  const events = await listEvents(session.userId, session.runId);
  const hit = events.find((event) => event.spanId === look || event.id === look);
  const hash = resultHash({ look, found: Boolean(hit), seq: hit?.seq ?? null });
  const span: EvidenceSpan = {
    id: spanId("trace", "get_span", hash),
    server: "trace",
    tool: "trace.get_span",
    citation: hit ? `Span ${look} → ${hit.type}` : `Span ${look} not found`,
    resultHash: hash,
  };
  return {
    ok: true,
    data: {
      found: Boolean(hit),
      type: hit?.type,
      seq: hit?.seq,
      span,
    },
    spanId: span.id,
  };
}

export async function replayFromSpan(
  args: Record<string, unknown>,
): Promise<
  ToolResult<{
    seq: number;
    nodeCount: number;
    edgeCount: number;
    span: EvidenceSpan;
  }>
> {
  const session = ctx(args);
  if (!session) return { ok: false, error: "userId and runId required" };
  const look = typeof args.spanId === "string" ? args.spanId : "";
  const live = await getRun(session.userId, session.runId);
  if (!live) return { ok: false, error: "Run not found" };
  const events = live.events ?? [];
  const hit = events.find((event) => event.spanId === look || event.id === look);
  const seq =
    typeof args.seq === "number"
      ? args.seq
      : (hit?.seq ?? events.at(-1)?.seq ?? -1);
  let replayed: RunSnapshot = {
    ...live,
    nodes: [],
    edges: [],
    scope: null,
    analyses: {},
    draft: null,
    events: [],
  };
  for (const event of events.filter((item) => item.seq <= seq)) {
    replayed = applyRunEvent(replayed, event);
  }
  const hash = resultHash({
    seq,
    nodes: replayed.nodes.map((node) => node.id),
    edges: replayed.edges.map((edge) => edge.id),
  });
  const span: EvidenceSpan = {
    id: spanId("trace", "replay_from_span", hash),
    server: "trace",
    tool: "trace.replay_from_span",
    citation: `Replayed through seq ${seq}`,
    resultHash: hash,
  };
  return {
    ok: true,
    data: {
      seq,
      nodeCount: replayed.nodes.length,
      edgeCount: replayed.edges.length,
      span,
    },
    spanId: span.id,
  };
}
