import { layoutNodes } from "@/lib/ai/layout";
import type { CrewStreamEvent } from "@/lib/ai/crew-events";
import type { RunEventDraft } from "@/lib/db/events";
import type { RunSnapshot } from "@/lib/platform-types";
import type { NodeAnalysis } from "@/schemas/analysis";
import type { DigressionEdge, DigressionNode } from "@/schemas/digression";
import type { RunEvent } from "@/schemas/run-event";
import type { ScopeContract } from "@/schemas/scope-contract";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function applyRunEvent(
  snapshot: RunSnapshot,
  event: RunEvent,
): RunSnapshot {
  const events = (snapshot.events ?? []).some((item) => item.id === event.id)
    ? snapshot.events
    : [...(snapshot.events ?? []), event];
  const next: RunSnapshot = { ...snapshot, events };

  switch (event.type) {
    case "run.started":
      return { ...next, run: { ...next.run, status: "running" } };
    case "run.completed":
      return { ...next, run: { ...next.run, status: "ready" } };
    case "run.failed":
      return { ...next, run: { ...next.run, status: "failed" } };
    case "run.created":
      return { ...next, run: { ...next.run, status: "draft" } };
    case "scope.updated": {
      const contract = asRecord(event.payload).contract as ScopeContract | undefined;
      return contract ? { ...next, scope: contract } : next;
    }
    case "node.created":
    case "node.updated":
    case "node.status_changed": {
      const payload = asRecord(event.payload);
      const node = payload.node as DigressionNode | undefined;
      const analysis = payload.analysis as NodeAnalysis | undefined;
      let nodes = next.nodes;
      if (node) {
        nodes = nodes.some((item) => item.id === node.id)
          ? nodes.map((item) => (item.id === node.id ? node : item))
          : [...nodes, node];
        nodes = layoutNodes(nodes, next.edges);
      } else if (
        event.type === "node.status_changed" &&
        typeof payload.nodeId === "string" &&
        typeof payload.status === "string"
      ) {
        nodes = nodes.map((item) =>
          item.id === payload.nodeId
            ? { ...item, status: payload.status as DigressionNode["status"] }
            : item,
        );
      }
      const analyses = analysis
        ? { ...next.analyses, [analysis.nodeId]: analysis }
        : next.analyses;
      return { ...next, nodes, analyses };
    }
    case "edge.created": {
      const edge = asRecord(event.payload).edge as DigressionEdge | undefined;
      if (!edge) return next;
      const edges = next.edges.some((item) => item.id === edge.id)
        ? next.edges.map((item) => (item.id === edge.id ? edge : item))
        : [...next.edges, edge];
      return { ...next, edges, nodes: layoutNodes(next.nodes, edges) };
    }
    case "export.generated": {
      const payload = asRecord(event.payload);
      const brief = typeof payload.brief === "string" ? payload.brief : "";
      const appendix = typeof payload.appendix === "string" ? payload.appendix : "";
      if (!brief && !appendix) return next;
      return {
        ...next,
        draft: { brief, appendix, updatedAt: event.ts },
      };
    }
    case "critic.flag": {
      const payload = asRecord(event.payload);
      const nodeId = typeof payload.nodeId === "string" ? payload.nodeId : "";
      if (!nodeId) return next;
      return {
        ...next,
        nodes: next.nodes.map((node) =>
          node.id === nodeId && node.status === "proposed"
            ? { ...node, status: "contested" }
            : node,
        ),
      };
    }
    default:
      return next;
  }
}

export function replayToSeq(live: RunSnapshot, seq: number): RunSnapshot {
  const events = [...(live.events ?? [])]
    .filter((event) => event.seq <= seq)
    .sort((a, b) => a.seq - b.seq);
  let state: RunSnapshot = {
    run: { ...live.run, status: "draft" },
    items: [],
    nodes: [],
    edges: [],
    scope: null,
    analyses: {},
    events: [],
    draft: null,
  };
  for (const event of events) {
    state = applyRunEvent(state, event);
  }
  return {
    ...state,
    run: { ...state.run, title: live.run.title, id: live.run.id },
    items: live.items,
  };
}

export function draftsFromCrewEvent(
  event: CrewStreamEvent,
  seenNarration: Set<string>,
  existingNodeIds: Set<string>,
): RunEventDraft[] {
  switch (event.type) {
    case "scope":
      return [{ type: "scope.updated", agent: "scoper", payload: { contract: event.contract } }];
    case "node":
      return [
        {
          type: existingNodeIds.has(event.node.id) ? "node.updated" : "node.created",
          agent: event.node.agent,
          payload: { node: event.node },
        },
      ];
    case "edge":
      return [{ type: "edge.created", payload: { edge: event.edge } }];
    case "analysis":
      return [
        {
          type: "node.updated",
          payload: { analysis: event.analysis, nodeId: event.analysis.nodeId },
        },
      ];
    case "narration_delta":
      if (seenNarration.has(event.id)) return [];
      seenNarration.add(event.id);
      return [{ type: "agent.turn_started", agent: event.agent }];
    case "narration":
      if (!seenNarration.has(event.item.id)) {
        seenNarration.add(event.item.id);
        return [
          { type: "agent.turn_started", agent: event.item.agent },
          { type: "agent.turn_completed", agent: event.item.agent },
        ];
      }
      return [{ type: "agent.turn_completed", agent: event.item.agent }];
    case "error":
      return [{ type: "run.failed", payload: { message: event.message } }];
    case "done":
      return [{ type: "run.completed" }];
    case "mcp":
      return [
        {
          type: event.ok ? "mcp.tool_result" : "mcp.tool_call",
          agent: event.agent,
          spanId: event.spanId,
          payload: {
            server: event.server,
            tool: event.tool,
            ok: event.ok,
            label: event.label,
          },
        },
      ];
    case "draft":
      return [
        {
          type: "export.generated",
          agent: "synthesizer",
          payload: { brief: event.brief, appendix: event.appendix },
        },
      ];
    case "flag":
      return [
        {
          type: "critic.flag",
          agent: "critic",
          payload: { nodeId: event.nodeId, message: event.message },
        },
      ];
    default:
      return [];
  }
}
