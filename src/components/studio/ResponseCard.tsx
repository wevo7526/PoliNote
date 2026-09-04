"use client";

import { AnalysisBody } from "@/components/studio/AnalysisBody";
import { EventLog } from "@/components/studio/EventLog";
import { NodeCard } from "@/components/studio/NodeCard";
import { ScopeCard } from "@/components/studio/ScopeCard";
import { eventNodeId, humanAgent } from "@/lib/ai/event-view";
import type { ThreadItem } from "@/components/studio/thread-types";
import type { RunEvent } from "@/schemas/run-event";

const ROLE: Record<string, string> = {
  scoper: "Locks the contract before the graph may grow.",
  instrument_parser: "Turns the instrument into series, statute, and literature queries.",
  literature: "Places claims, mechanisms, and incidence on the map.",
  series: "Attaches FRED vintages. Cannot mark a node supported alone.",
  legal: "Attaches statute or official-text spans.",
  macro: "Places channels and constraints, not point estimates.",
  incidence: "Asks who pays and who gains.",
  critic: "Attacks identification. Cannot add a positive claim.",
  synthesizer: "Writes the brief from node IDs only.",
  trace_narrator: "Reads the event log back as a trace.",
};

type ResponseCardProps = {
  items: ThreadItem[];
  events: RunEvent[];
  finished: boolean;
  onOpenNode: (id: string) => void;
};

function mcpChips(events: RunEvent[]): Array<{ id: string; label: string; ok: boolean }> {
  const chips: Array<{ id: string; label: string; ok: boolean }> = [];
  for (const event of events) {
    if (event.type !== "mcp.tool_call" && event.type !== "mcp.tool_result") continue;
    const payload = event.payload ?? {};
    const label =
      typeof payload.label === "string"
        ? payload.label
        : [payload.server, payload.tool].filter((part) => typeof part === "string").join(" · ");
    chips.push({
      id: event.id,
      label: label || "MCP",
      ok: payload.ok !== false,
    });
  }
  return chips;
}

function nodeChips(
  events: RunEvent[],
): Array<{ id: string; title: string }> {
  const seen = new Set<string>();
  const nodes: Array<{ id: string; title: string }> = [];
  for (const event of events) {
    const id = eventNodeId(event);
    const title = (event.payload.node as { title?: string } | undefined)?.title;
    if (!id || seen.has(id) || !title) continue;
    seen.add(id);
    nodes.push({ id, title });
  }
  return nodes;
}

export function ResponseCard({
  items,
  events,
  finished,
  onOpenNode,
}: ResponseCardProps) {
  const narrations = items.filter((item) => item.kind === "narration");
  const lead = narrations[narrations.length - 1];
  const chips = mcpChips(events);
  const nodes = nodeChips(events);
  const working = items.find((item) => item.kind === "status" && item.id === "crew-working");
  const notices = items.filter(
    (item) => item.kind === "status" && item.id !== "crew-working",
  );

  return (
    <article className="response-card">
      {lead ? (
        <header className="response-head">
          <p className="response-agent">{humanAgent(lead.agent)}</p>
          {ROLE[lead.agent] ? <p className="response-role">{ROLE[lead.agent]}</p> : null}
        </header>
      ) : null}

      {items.map((item) => {
        if (item.kind === "narration") {
          return (
            <section key={item.id} className="response-agent-block">
              {narrations.length > 1 ? (
                <p className="response-agent-mini">{humanAgent(item.agent)}</p>
              ) : null}
              <AnalysisBody text={item.text} />
            </section>
          );
        }
        if (item.kind === "scope") {
          return <ScopeCard key={item.id} contract={item.contract} />;
        }
        if (item.kind === "node") {
          return <NodeCard key={item.id} node={item.node} onOpen={onOpenNode} />;
        }
        return null;
      })}

      {working?.kind === "status" ? (
        <p className="response-working">{working.text}</p>
      ) : null}

      {notices.map((item) =>
        item.kind === "status" ? (
          <p key={item.id} className="response-notice">
            {item.text}
          </p>
        ) : null,
      )}

      {chips.length > 0 ? (
        <div className="response-mcp">
          <p className="response-actions-label">MCP</p>
          <div className="response-actions-row">
            {chips.map((chip) => (
              <span
                key={chip.id}
                className={`mcp-chip ${chip.ok ? "is-ok" : "is-fail"}`}
              >
                {chip.label}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {nodes.length > 0 ? (
        <div className="response-actions">
          <p className="response-actions-label">On the graph</p>
          <div className="response-actions-row">
            {nodes.map((node) => (
              <button
                key={node.id}
                type="button"
                className="response-node-btn"
                onClick={() => onOpenNode(node.id)}
              >
                {node.title}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {finished && events.length > 0 ? (
        <EventLog events={events} onOpenNode={onOpenNode} />
      ) : null}
    </article>
  );
}
