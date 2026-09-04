import { layoutNodes } from "@/lib/ai/layout";
import type { RunSnapshot } from "@/lib/platform-types";
import type { ThreadItem } from "@/components/studio/thread-types";
import type { NodeAnalysis } from "@/schemas/analysis";
import type { DigressionEdge, DigressionNode } from "@/schemas/digression";
import type { RunEvent } from "@/schemas/run-event";
import type { ScopeContract } from "@/schemas/scope-contract";

export const WORKING_STATUS_ID = "crew-working";

export type CrewStreamEvent =
  | { type: "user"; item: Extract<ThreadItem, { kind: "user" }> }
  | { type: "status"; item: Extract<ThreadItem, { kind: "status" }> }
  | { type: "narration"; item: Extract<ThreadItem, { kind: "narration" }> }
  | { type: "narration_delta"; id: string; agent: string; delta: string }
  | { type: "scope"; itemId: string; contract: ScopeContract }
  | { type: "node"; node: DigressionNode }
  | { type: "edge"; edge: DigressionEdge }
  | { type: "analysis"; analysis: NodeAnalysis }
  | { type: "title"; title: string }
  | { type: "error"; message: string }
  | { type: "done" }
  | { type: "log"; event: RunEvent }
  | {
      type: "mcp";
      agent: string;
      server: string;
      tool: string;
      ok: boolean;
      label: string;
      spanId?: string;
    }
  | { type: "draft"; brief: string; appendix: string }
  | { type: "flag"; nodeId: string; message: string };

export function workingStatus(text: string): CrewStreamEvent {
  return {
    type: "status",
    item: { id: WORKING_STATUS_ID, kind: "status", text },
  };
}

export function publicCrewError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/invalid_type|invalid_value|expected string|Model returned no JSON/i.test(raw)) {
    return "The crew returned a malformed graph. Send the question again.";
  }
  if (/OPENAI_API_KEY|api key|incorrect api|authentication/i.test(raw)) {
    return "OpenAI rejected the request. Check OPENAI_API_KEY on the server.";
  }
  if (/429|rate limit/i.test(raw)) {
    return "OpenAI rate-limited this turn. Wait a moment and try again.";
  }
  if (/model/i.test(raw) && /not found|does not exist|unsupported/i.test(raw)) {
    return "The configured OpenAI model is not available on this key.";
  }
  if (/already closed|controller is already closed/i.test(raw)) {
    return "The run stream closed while the crew was still writing. Refresh the run — saved nodes stay.";
  }
  if (/verified to generate reasoning summaries|reasoning\.summary/i.test(raw)) {
    return "OpenAI blocked reasoning summaries on this organization. The crew will retry without them.";
  }
  if (/timeout|etimedout|aborted|abort/i.test(raw)) {
    return "The crew timed out mid-turn.";
  }
  const trimmed = raw.replace(/\s+/g, " ").trim();
  return trimmed.slice(0, 280) || "The crew could not finish this turn.";
}

export function applyCrewEvent(
  snapshot: RunSnapshot,
  event: CrewStreamEvent,
): RunSnapshot {
  snapshot = { ...snapshot, events: snapshot.events ?? [], draft: snapshot.draft ?? null };
  switch (event.type) {
    case "log": {
      if (snapshot.events.some((item) => item.id === event.event.id)) return snapshot;
      return { ...snapshot, events: [...snapshot.events, event.event] };
    }
    case "user": {
      const lastUser = [...snapshot.items]
        .reverse()
        .find((item) => item.kind === "user");
      if (lastUser?.kind === "user" && lastUser.text === event.item.text) {
        if (lastUser.id === event.item.id) return snapshot;
        return {
          ...snapshot,
          items: snapshot.items.map((item) =>
            item.id === lastUser.id ? event.item : item,
          ),
        };
      }
      return { ...snapshot, items: [...snapshot.items, event.item] };
    }
    case "status": {
      const index = snapshot.items.findIndex((item) => item.id === event.item.id);
      if (index >= 0) {
        const items = snapshot.items.slice();
        items[index] = event.item;
        return { ...snapshot, items };
      }
      return { ...snapshot, items: [...snapshot.items, event.item] };
    }
    case "narration": {
      const index = snapshot.items.findIndex((item) => item.id === event.item.id);
      if (index >= 0) {
        const items = snapshot.items.slice();
        items[index] = event.item;
        return { ...snapshot, items };
      }
      return { ...snapshot, items: [...snapshot.items, event.item] };
    }
    case "narration_delta": {
      const index = snapshot.items.findIndex((item) => item.id === event.id);
      if (index >= 0 && snapshot.items[index]?.kind === "narration") {
        const current = snapshot.items[index];
        if (current.kind !== "narration") return snapshot;
        const items = snapshot.items.slice();
        items[index] = { ...current, text: current.text + event.delta };
        return { ...snapshot, items };
      }
      return {
        ...snapshot,
        items: [
          ...snapshot.items,
          {
            id: event.id,
            kind: "narration",
            agent: event.agent,
            text: event.delta,
          },
        ],
      };
    }
    case "scope": {
      const items = snapshot.items.some((item) => item.kind === "scope")
        ? snapshot.items.map((item) =>
            item.kind === "scope"
              ? { ...item, contract: event.contract }
              : item,
          )
        : [
            ...snapshot.items,
            { id: event.itemId, kind: "scope" as const, contract: event.contract },
          ];
      return { ...snapshot, scope: event.contract, items };
    }
    case "node": {
      const nodes = snapshot.nodes.some((node) => node.id === event.node.id)
        ? snapshot.nodes.map((node) =>
            node.id === event.node.id ? event.node : node,
          )
        : [...snapshot.nodes, event.node];
      return { ...snapshot, nodes: layoutNodes(nodes) };
    }
    case "edge": {
      const edges = snapshot.edges.some((edge) => edge.id === event.edge.id)
        ? snapshot.edges.map((edge) =>
            edge.id === event.edge.id ? event.edge : edge,
          )
        : [...snapshot.edges, event.edge];
      return { ...snapshot, edges };
    }
    case "analysis":
      return {
        ...snapshot,
        analyses: { ...snapshot.analyses, [event.analysis.nodeId]: event.analysis },
      };
    case "title":
      return {
        ...snapshot,
        run: { ...snapshot.run, title: event.title, status: "running" },
      };
    case "error":
      return {
        ...snapshot,
        run: { ...snapshot.run, status: "failed" },
        items: [
          ...snapshot.items.filter((item) => item.id !== WORKING_STATUS_ID),
          {
            id: `crew-error-${snapshot.items.length}`,
            kind: "status",
            text: event.message,
          },
        ],
      };
    case "done":
      return {
        ...snapshot,
        run: { ...snapshot.run, status: "ready" },
        items: snapshot.items.filter((item) => item.id !== WORKING_STATUS_ID),
      };
    case "draft":
      return {
        ...snapshot,
        draft: {
          brief: event.brief,
          appendix: event.appendix,
          updatedAt: new Date().toISOString(),
        },
      };
    case "flag": {
      const nodes = snapshot.nodes.map((node) =>
        node.id === event.nodeId && node.status === "proposed"
          ? { ...node, status: "contested" as const }
          : node,
      );
      return { ...snapshot, nodes };
    }
    case "mcp":
      return snapshot;
    default:
      return snapshot;
  }
}
