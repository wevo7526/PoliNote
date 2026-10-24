"use client";

import { useMemo } from "react";
import Link from "next/link";
import { AnalysisBody } from "@/components/studio/AnalysisBody";
import { EventLog } from "@/components/studio/EventLog";
import {
  CounterfactualTrajectoryChart,
  DistributionalIncidenceBarChart,
  EconomicScorecardBanner,
  FredSeriesChartCard,
  ImpulseResponseChart,
  extractFredSeries,
} from "@/components/studio/ReportCharts";
import { ScopeCard } from "@/components/studio/ScopeCard";
import { eventNodeId, humanAgent } from "@/lib/ai/event-view";
import { buildRunEconomicModel } from "@/lib/economics/engine";
import {
  NODE_KIND_TAXONOMY,
  NODE_STATUS_TAXONOMY,
} from "@/lib/ui/node-taxonomy";
import type { ThreadItem } from "@/components/studio/thread-types";
import type { NodeAnalysis } from "@/schemas/analysis";
import type { DigressionNode } from "@/schemas/digression";
import type { RunEvent } from "@/schemas/run-event";
import type { ScopeContract } from "@/schemas/scope-contract";

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
  question?: string;
  items: ThreadItem[];
  events: RunEvent[];
  nodes?: DigressionNode[];
  analyses?: Record<string, NodeAnalysis>;
  scope?: ScopeContract | null;
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
  question = "",
  items,
  events,
  nodes: graphNodes = [],
  analyses = {},
  scope = null,
  finished,
  onOpenNode,
}: ResponseCardProps) {
  const narrations = items.filter((item) => item.kind === "narration");
  const scopeItem = items.find((item) => item.kind === "scope");
  const activeScope = scopeItem?.kind === "scope" ? scopeItem.contract : scope;
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

  const fredSeries = useMemo(
    () => extractFredSeries(turnNodes.length > 0 ? turnNodes : graphNodes),
    [turnNodes, graphNodes],
  );

  const econModel = useMemo(() => {
    const targetNodes = turnNodes.length > 0 ? turnNodes : graphNodes;
    if (targetNodes.length === 0 && !activeScope) return null;
    return buildRunEconomicModel({
      question: question || activeScope?.question || "Policy evaluation",
      scope: activeScope,
      nodes: targetNodes,
      fredSeries,
    });
  }, [question, activeScope, turnNodes, graphNodes, fredSeries]);

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
            {finished ? "Economic Analysis & Policy Output" : "Crew Building Analysis…"}
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
            Report & Word / PDF Export →
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

      {/* 2. Quantitative Economic Scorecard */}
      {econModel && turnNodes.length > 0 ? (
        <EconomicScorecardBanner scorecard={econModel.scorecard} compact />
      ) : null}

      {/* 3. Executive Synthesis & Key Findings */}
      {leadNarration ? (
        <section className="response-agent-block">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--copper)]">
              {humanAgent(leadNarration.agent)} —{" "}
              {ROLE[leadNarration.agent] ?? "Executive Synthesis"}
            </span>
          </div>
          <AnalysisBody
            text={leadNarration.text}
            nodes={graphNodes}
            onOpenNode={onOpenNode}
          />
        </section>
      ) : null}

      {/* 4. Inline Time-Series & Economic Charts right inside the Output Panel */}
      {econModel && econModel.dataAvailable && turnNodes.length > 0 ? (
        <div className="space-y-3 border-t border-[var(--line)] pt-3">
          <div className="flex items-center justify-between">
            <p className="response-actions-label">
              Live Counterfactual Projections, Jordà Local Projections & Specification Curve
            </p>
          </div>
          {econModel.counterfactual ? (
            <CounterfactualTrajectoryChart
              series={econModel.counterfactual}
              compact
            />
          ) : null}
          {fredSeries.slice(0, 1).map((series) => (
            <FredSeriesChartCard key={series.key} series={series} />
          ))}
          <details className="border border-[var(--line)] bg-[var(--bg)]/45 p-3">
            <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--copper)]">
              View Jordà Local Projections & Automatic Specification Curve
            </summary>
            <div className="mt-3 space-y-3">
              {econModel.impulseResponse ? (
                <ImpulseResponseChart
                  series={econModel.impulseResponse}
                  compact
                />
              ) : null}
              <DistributionalIncidenceBarChart
                items={econModel.incidenceDistribution}
                robustness={econModel.robustness}
              />
            </div>
          </details>
        </div>
      ) : null}

      {/* 5. Clear Node Cards with Inline Deep Economic Analysis */}
      {turnNodes.length > 0 ? (
        <div className="space-y-2 border-t border-[var(--line)] pt-3">
          <div className="flex items-center justify-between">
            <p className="response-actions-label">
              Stage-by-Stage Argument Nodes & Deep Economic Analysis ({turnNodes.length})
            </p>
          </div>
          <div className="grid gap-2">
            {turnNodes.map((node) => {
              const kindInfo = NODE_KIND_TAXONOMY[node.kind];
              const statusInfo = NODE_STATUS_TAXONOMY[node.status];
              const nodeAnalysis = analyses[node.id];
              return (
                <div
                  key={node.id}
                  className="border border-[var(--line)] bg-[var(--bg)]/55 p-3 transition hover:border-[var(--copper)]/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className="text-[9.5px] font-semibold uppercase tracking-[0.12em]"
                          style={{ color: kindInfo.color }}
                        >
                          {kindInfo.stage} · {kindInfo.label}
                        </span>
                      </div>
                      <h4 className="mt-1 font-[family-name:var(--font-display)] text-sm font-medium text-[var(--ink)]">
                        {node.title}
                      </h4>
                      <p className="mt-1 text-xs leading-relaxed text-[var(--ink)]/85">
                        {node.body}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <span
                        className="px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em]"
                        style={{
                          backgroundColor: statusInfo.bgColor,
                          color: statusInfo.color,
                        }}
                      >
                        {statusInfo.shortLabel}
                      </span>
                      <button
                        type="button"
                        onClick={() => onOpenNode(node.id)}
                        className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--copper)] hover:underline"
                      >
                        Full Trace & Chart ↗
                      </button>
                    </div>
                  </div>

                  {nodeAnalysis?.body ? (
                    <details className="mt-2 border-t border-[var(--line)] pt-2">
                      <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)] hover:text-[var(--copper)]">
                        Expand 5-Section Economic Analysis (Mechanism, Incidence, Identification, Sign Flip)
                      </summary>
                      <div className="mt-2">
                        <AnalysisBody
                          text={nodeAnalysis.body}
                          nodes={graphNodes}
                          onOpenNode={onOpenNode}
                        />
                      </div>
                    </details>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* 6. How This Output Was Made: Collapsible Trace of Agent Steps, Data Sources & Scope */}
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

          {activeScope ? <ScopeCard contract={activeScope} /> : null}

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
