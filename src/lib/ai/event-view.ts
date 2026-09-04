import type { RunEvent } from "@/schemas/run-event";

export function eventsForAgentTurn(
  events: RunEvent[],
  agent: string,
  occurrence: number,
): RunEvent[] {
  const starts = events.filter(
    (event) => event.type === "agent.turn_started" && event.agent === agent,
  );
  const start = starts[occurrence];
  if (!start) {
    return events.filter(
      (event) =>
        event.agent === agent ||
        (agent === "scoper" && event.type === "scope.updated"),
    );
  }
  const next = events.find(
    (event) => event.seq > start.seq && event.type === "agent.turn_started",
  );
  const end = next?.seq ?? Number.POSITIVE_INFINITY;
  return events.filter(
    (event) =>
      event.seq >= start.seq &&
      event.seq < end &&
      event.type !== "run.created" &&
      event.type !== "run.completed",
  );
}

export function eventsForScope(events: RunEvent[]): RunEvent[] {
  return events.filter((event) => event.type === "scope.updated");
}

export function humanAgent(agent: string | undefined): string {
  if (!agent) return "Crew";
  const names: Record<string, string> = {
    scoper: "Scoper",
    instrument_parser: "Instrument parser",
    literature: "Literature",
    trace_narrator: "Trace",
    critic: "Critic",
    incidence: "Incidence",
    legal: "Legal",
    series: "Series",
    macro: "Macro",
    synthesizer: "Synthesizer",
  };
  return names[agent] ?? agent.replace(/_/g, " ");
}

export function eventLabel(event: RunEvent): string {
  const payload = event.payload ?? {};
  const node = payload.node as { title?: string; kind?: string } | undefined;
  switch (event.type) {
    case "run.started":
      return "Run started";
    case "run.failed":
      return typeof payload.message === "string" ? payload.message : "Run failed";
    case "scope.updated":
      return "Scope contract written";
    case "agent.turn_started":
      return `${humanAgent(event.agent)} started`;
    case "agent.turn_completed":
      return `${humanAgent(event.agent)} finished`;
    case "node.created":
      return node?.title ? `Placed ${node.title}` : "Node placed";
    case "node.updated":
      return node?.title ? `Updated ${node.title}` : "Node updated";
    case "edge.created":
      return "Edge added";
    case "critic.flag":
      return typeof payload.message === "string" ? payload.message : "Critic flag";
    case "llm.call":
      return "Model call";
    case "mcp.tool_call":
    case "mcp.tool_result":
      return typeof payload.label === "string" ? payload.label : "MCP call";
    case "export.generated":
      return "Draft written";
    default:
      return event.type.replace(/\./g, " · ");
  }
}

export function eventNodeId(event: RunEvent): string | null {
  const payload = event.payload ?? {};
  const node = payload.node as { id?: string } | undefined;
  if (node?.id) return node.id;
  if (typeof payload.nodeId === "string") return payload.nodeId;
  return null;
}
