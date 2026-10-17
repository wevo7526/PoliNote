"use client";

import { AnalysisBody } from "@/components/studio/AnalysisBody";
import { EventLog } from "@/components/studio/EventLog";
import { NodeCard } from "@/components/studio/NodeCard";
import { ScopeCard } from "@/components/studio/ScopeCard";
import { eventNodeId, humanAgent } from "@/lib/ai/event-view";
import type { ThreadItem } from "@/components/studio/thread-types";
import type { DigressionNode } from "@/schemas/digression";
import type { RunEvent } from "@/schemas/run-event";

const ROLE: Record<string, string> = {
  scoper: "Locks the Scope Contract before the graph grows.",
  instrument_parser: "Derives FRED, literature, and statutory queries.",
  literature: "Places the policy spine & digressions on the map.",
  series: "Attaches FRED time-series spans.",
  legal: "Attaches statutory or official policy spans.",
  macro: "Places macro context & series.",
  incidence: "Maps who pays and who gains.",
  critic: "Audits identification & unverified claims.",
  synthesizer: "Compiles the report from grounded node IDs.",
  trace_narrator: "Verifies the domain event record.",
};

const PIPELINE_STEPS = [
  { key: "scoper", label: "01 Scope" },
  { key: "instrument_parser", label: "02 Parser" },
  { key: "literature", label: "03 Spine" },
  { key: "mcp", label: "04 MCP Spans" },
  { key: "critic", label: "05 Critic" },
  { key: "synthesizer", label: "06 Report" },
] as const;

type ResponseCardProps = {
  items: ThreadItem[];
  events: RunEvent[];
  nodes?: DigressionNode[];
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
        : [payload.server, payload.tool]
            .filter((part) => typeof part === "string")
            .join(" · ");
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
  nodes: graphNodes = [],
  finished,
  onOpenNode,
}: ResponseCardProps) {
  const narrations = items.filter((item) => item.kind === "narration");
  const seenAgents = new Set<string>(narrations.map((n) => n.agent));
  const chips = mcpChips(events);
  if (chips.length > 0) seenAgents.add("mcp");
  if (items.some((i) => i.kind === "scope")) seenAgents.add("scoper");

  const placedNodes = nodeChips(events);
  const working = items.find(
    (item) => item.kind === "status" && item.id === "crew-working",
  );
  const notices = items.filter(
    (item) => item.kind === "status" && item.id !== "crew-working",
  );

  return (
    <article className="response-card">
      <header className="response-head">
        <div className="flex items-center justify-between gap-2">
          <p className="response-agent">
            {finished ? "Crew Turn Digest" : "Crew Running…"}
          </p>
          <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">
            {placedNodes.length} nodes · {chips.filter((c) => c.ok).length} MCP spans
          </span>
        </div>

        <div className="crew-step-strip">
          {PIPELINE_STEPS.map((step) => {
            const done = finished || seenAgents.has(step.key);
            return (
              <span
                key={step.key}
                className={`crew-step-badge ${done ? "is-done" : ""}`}
              >
                {step.label}
              </span>
            );
          })}
        </div>
      </header>

      {items.map((item) => {
        if (item.kind === "scope") {
          return <ScopeCard key={item.id} contract={item.contract} />;
        }
        if (item.kind === "narration") {
          return (
            <section key={item.id} className="response-agent-block">
              <div className="flex items-baseline justify-between gap-2">
                <p className="response-agent-mini">{humanAgent(item.agent)}</p>
                {ROLE[item.agent] ? (
                  <p className="text-[11px] text-[var(--muted)]">{ROLE[item.agent]}</p>
                ) : null}
              </div>
              <AnalysisBody
                text={item.text}
                nodes={graphNodes}
                onOpenNode={onOpenNode}
              />
            </section>
          );
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
          <p className="response-actions-label">Empirical MCP Spans & Tool Calls</p>
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

      {placedNodes.length > 0 ? (
        <div className="response-actions">
          <p className="response-actions-label">Placed & Updated on the Graph</p>
          <div className="response-actions-row">
            {placedNodes.map((node) => (
              <button
                key={node.id}
                type="button"
                className="response-node-btn"
                onClick={() => onOpenNode(node.id)}
              >
                ↗ {node.title}
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
