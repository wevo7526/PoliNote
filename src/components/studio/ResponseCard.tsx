"use client";

import Link from "next/link";
import { AnalysisBody } from "@/components/studio/AnalysisBody";
import { EventLog } from "@/components/studio/EventLog";
import { ScopeCard } from "@/components/studio/ScopeCard";
import { eventNodeId, humanAgent } from "@/lib/ai/event-view";
import {
  NODE_KIND_TAXONOMY,
  NODE_STATUS_TAXONOMY,
} from "@/lib/ui/node-taxonomy";
import type { ThreadItem } from "@/components/studio/thread-types";
import type { DigressionNode } from "@/schemas/digression";
import type { RunEvent } from "@/schemas/run-event";

const ROLE: Record<string, string> = {
  scoper: "Locked the Scope Contract",
  instrument_parser: "Selected FRED, OpenAlex & statutory queries",
  literature: "Mapped policy spine & digression branches",
  series: "Attached FRED economic time-series data",
  legal: "Attached statutory & official policy text",
  macro: "Attached macroeconomic context",
  incidence: "Mapped distributional winners & losers",
  critic: "Audited identification & unverified claims",
  synthesizer: "Compiled the policy findings",
};

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

function placedNodeIds(events: RunEvent[]): string[] {
  const seen = new Set<string>();
  for (const event of events) {
    const id = eventNodeId(event);
    if (id) seen.add(id);
  }
  return [...seen];
}

export function ResponseCard({
  items,
  events,
  nodes: graphNodes = [],
  finished,
  onOpenNode,
}: ResponseCardProps) {
  const narrations = items.filter((item) => item.kind === "narration");
  const scopeItem = items.find((item) => item.kind === "scope");
  const chips = mcpChips(events);
  const okChips = chips.filter((c) => c.ok);

  const nodeById = new Map(graphNodes.map((n) => [n.id, n]));
  const turnNodeIds = placedNodeIds(events);
  const turnNodes =
    turnNodeIds.length > 0
      ? turnNodeIds
          .map((id) => nodeById.get(id))
          .filter((n): n is DigressionNode => Boolean(n))
      : graphNodes;

  // Separate primary conclusion (critic / synthesizer / latest narration) from intermediate steps
  const leadNarration = narrations[narrations.length - 1];
  const intermediateNarrations =
    narrations.length > 1 ? narrations.slice(0, -1) : [];

  const working = items.find(
    (item) => item.kind === "status" && item.id === "crew-working",
  );
  const notices = items.filter(
    (item) => item.kind === "status" && item.id !== "crew-working",
  );

  const runId = graphNodes[0]?.runId ?? events[0]?.runId ?? "";

  return (
    <article className="response-card">
      {/* 1. Primary Output Header */}
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] pb-2.5">
        <div>
          <p className="response-agent">
            {finished ? "Policy Output & Trace" : "Crew Building Output…"}
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">
            {turnNodes.filter((n) => n.status === "supported").length} verified ·{" "}
            {turnNodes.length} total nodes · {okChips.length} empirical data source
            {okChips.length === 1 ? "" : "s"}
          </p>
        </div>

        {finished && runId ? (
          <Link
            href={`/app/draft?run=${runId}`}
            className="node-action border-[var(--copper)]/60 bg-[var(--copper)]/12 text-[var(--copper)]"
          >
            Compile Word / PDF Report →
          </Link>
        ) : null}
      </header>

      {/* Active streaming status */}
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

      {/* 2. Key Takeaway / Primary Output */}
      {leadNarration ? (
        <section className="response-agent-block">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--copper)]">
              {humanAgent(leadNarration.agent)} —{" "}
              {ROLE[leadNarration.agent] ?? "Summary"}
            </span>
          </div>
          <AnalysisBody
            text={leadNarration.text}
            nodes={graphNodes}
            onOpenNode={onOpenNode}
          />
        </section>
      ) : null}

      {/* 3. Clear Node Cards: What Was Placed & What Each Node Means */}
      {turnNodes.length > 0 ? (
        <div className="space-y-2 border-t border-[var(--line)] pt-3">
          <div className="flex items-center justify-between">
            <p className="response-actions-label">
              Argument Nodes Built (Click Any Node to Trace How It Was Made)
            </p>
          </div>
          <div className="grid gap-1.5">
            {turnNodes.map((node) => {
              const kindInfo = NODE_KIND_TAXONOMY[node.kind];
              const statusInfo = NODE_STATUS_TAXONOMY[node.status];
              return (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => onOpenNode(node.id)}
                  className="flex w-full items-center justify-between gap-3 border border-[var(--line)] bg-[var(--bg)]/55 px-3 py-2 text-left transition hover:border-[var(--copper)]/50 hover:bg-[var(--paper-strong)]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className="text-[9.5px] font-semibold uppercase tracking-[0.12em]"
                        style={{ color: kindInfo.color }}
                      >
                        {kindInfo.shortLabel}
                      </span>
                      <span className="text-[10px] text-[var(--muted)]">
                        · {kindInfo.stage}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs font-medium text-[var(--ink)]">
                      {node.title}
                    </p>
                  </div>
                  <span
                    className="shrink-0 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em]"
                    style={{
                      backgroundColor: statusInfo.bgColor,
                      color: statusInfo.color,
                    }}
                  >
                    {statusInfo.shortLabel}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* 4. How This Output Was Made: Collapsible Trace of Agent Steps, Data Sources & Scope */}
      <details className="event-log">
        <summary className="event-log-summary">
          <span>How this output was made (Agent steps, data sources & scope)</span>
          <span className="event-log-count">
            {intermediateNarrations.length + 1} steps · {okChips.length} data spans
          </span>
        </summary>

        <div className="mt-3 space-y-3">
          {okChips.length > 0 ? (
            <div>
              <p className="response-actions-label mb-1.5">
                Empirical Data & Official Sources Pulled (MCP)
              </p>
              <div className="response-actions-row">
                {okChips.map((chip) => (
                  <span key={chip.id} className="mcp-chip is-ok">
                    ✓ {chip.label}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {scopeItem?.kind === "scope" ? (
            <ScopeCard contract={scopeItem.contract} />
          ) : null}

          {intermediateNarrations.map((step) => (
            <div
              key={step.id}
              className="border border-[var(--line)] bg-[var(--bg)]/45 p-3"
            >
              <p className="response-agent-mini">
                {humanAgent(step.agent)} · {ROLE[step.agent] ?? "Step"}
              </p>
              <AnalysisBody
                text={step.text}
                nodes={graphNodes}
                onOpenNode={onOpenNode}
              />
            </div>
          ))}
        </div>
      </details>

      {finished && events.length > 0 ? (
        <EventLog events={events} onOpenNode={onOpenNode} />
      ) : null}
    </article>
  );
}
