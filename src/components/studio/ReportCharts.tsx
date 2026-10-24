"use client";

import { useMemo, useState } from "react";
import type { DataProvenance, FetchedSeriesBundle } from "@/lib/data/types";
import type {
  CounterfactualSeries,
  EconomicScorecard,
  ImpulseResponseSeries,
  IncidenceBarItem,
  RunEconomicModel,
} from "@/lib/economics/engine";
import {
  buildDefaultSkepticForks,
  evaluateSpecificationFork,
  type ForkComparisonResult,
} from "@/lib/economics/forks";
import {
  METHOD_CATALOG,
  type EconometricEstimate,
  type RobustnessBundle,
} from "@/lib/economics/schemas";
import { LANE_LABEL, SPINE_LANES, nodeLane, type PolicyLane } from "@/lib/ai/layout";
import {
  NODE_KIND_TAXONOMY,
  NODE_STATUS_TAXONOMY,
} from "@/lib/ui/node-taxonomy";
import { shortNodeKey } from "@/lib/ui/prose";
import type { NodeAnalysis } from "@/schemas/analysis";
import type { DigressionNode } from "@/schemas/digression";
import type { RunEvent } from "@/schemas/run-event";

export type ExtractedSeries = {
  key: string;
  seriesId: string;
  title: string;
  units: string;
  url?: string;
  spanId?: string;
  vintage?: string;
  resultHash?: string;
  provenance?: DataProvenance;
  nodeTitle: string;
  points: Array<{ date: string; value: number }>;
};

export function extractFredSeries(nodes: DigressionNode[]): ExtractedSeries[] {
  const seen = new Set<string>();
  const out: ExtractedSeries[] = [];
  for (const node of nodes) {
    for (const chip of node.provenance) {
      if (!chip.seriesPoints || chip.seriesPoints.length < 2) continue;
      const id = chip.seriesId || chip.spanId || chip.label;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        key: id,
        seriesId: chip.seriesId ?? "FRED",
        title: chip.seriesTitle || chip.label,
        units: chip.units ?? "",
        url: chip.url,
        spanId: chip.spanId,
        vintage: chip.vintage,
        resultHash: chip.resultHash,
        nodeTitle: node.title,
        points: chip.seriesPoints,
      });
    }
  }
  return out;
}

/**
 * 7-Stage Run Timeline Strip:
 * Scope -> Lock -> Fetch -> Estimate -> Robustness -> Critique -> Synthesis
 */
export function RunTimelineStrip({
  events = [],
  nodes = [],
  busy = false,
  hasEstimates = false,
}: {
  events?: RunEvent[];
  nodes?: DigressionNode[];
  busy?: boolean;
  hasEstimates?: boolean;
}) {
  const hasScope = events.some((e) => e.type === "scope.updated") || nodes.length > 0;
  const hasFetch = events.some((e) => e.type === "mcp.tool_result");
  const hasFailedFetch =
    !hasFetch &&
    (events.some((e) => e.type === "mcp.tool_call") ||
      nodes.some((n) => n.status === "unverifiable"));
  const hasCritique =
    events.some((e) => e.type === "critic.flag") ||
    events.some((e) => e.agent === "skeptic" || e.agent === "critic") ||
    nodes.some((n) => n.status !== "proposed");
  const hasSynth = events.some((e) => e.type === "export.generated" || e.type === "run.completed");

  const stages = [
    { id: "scope", label: "1. Scope", done: hasScope, error: false },
    { id: "lock", label: "2. Lock Spec", done: hasScope, error: false },
    { id: "fetch", label: "3. Live Fetch", done: hasFetch, error: hasFailedFetch && !busy },
    { id: "estimate", label: "4. Estimate", done: hasEstimates || hasFetch, error: hasFailedFetch && !busy },
    { id: "robustness", label: "5. Robustness", done: hasEstimates || hasFetch, error: false },
    { id: "critique", label: "6. Skeptic Critique", done: hasCritique, error: false },
    { id: "synthesis", label: "7. Audited Synthesis", done: hasSynth, error: false },
  ];

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 border border-[var(--line)] bg-[var(--bg)]/65 px-3 py-2"
      role="region"
      aria-label="7-stage econometric run timeline"
    >
      <span className="mr-1 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-[var(--copper)]">
        Pipeline:
      </span>
      {stages.map((st) => (
        <span
          key={st.id}
          className={`px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.1em] ${
            st.error
              ? "border border-[#d46a6a]/50 bg-[#d46a6a]/15 text-[#d46a6a]"
              : st.done
                ? "border border-[#8fbf9a]/45 bg-[#8fbf9a]/12 text-[#8fbf9a]"
                : busy
                  ? "border border-[var(--copper)]/40 bg-[var(--copper)]/10 text-[var(--copper)]"
                  : "border border-[var(--line)] bg-[var(--paper)] text-[var(--muted)]"
          }`}
        >
          {st.error ? `✕ ${st.label}` : st.done ? `✓ ${st.label}` : st.label}
        </span>
      ))}
    </div>
  );
}

export function EconomicScorecardBanner({
  scorecard,
  compact = false,
}: {
  scorecard: EconomicScorecard;
  compact?: boolean;
}) {
  const items = [
    { label: "Sample & Policy Date", value: scorecard.shockMagnitude, accent: "text-[var(--copper)]" },
    { label: "Point Estimate & 95% CI", value: scorecard.primaryMetricDelta, accent: "text-[#8fbf9a]" },
    { label: "Local Projection Peak", value: scorecard.realOutputDelta, accent: "text-[var(--ink)]" },
    { label: "SE Method & p-value", value: scorecard.elasticitySummary, accent: "text-[var(--ink)]" },
    { label: "Observation Window", value: scorecard.timeToPeak, accent: "text-[var(--muted)]" },
    { label: "Robustness & Honesty Label", value: scorecard.verificationStanding, accent: "text-[#8fbf9a]" },
  ];

  return (
    <div className="border border-[var(--line)] bg-[var(--paper)] p-3.5">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--copper)]">
          Live Econometric Analysis · {scorecard.domainLabel}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <span className="border border-[var(--copper)]/45 bg-[var(--copper)]/12 px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-[var(--copper)]">
            {scorecard.honestyLabel}
          </span>
          {scorecard.preRegistrationHash ? (
            <span className="font-mono text-[10px] text-[var(--muted)]">
              Lock: {scorecard.preRegistrationHash}
            </span>
          ) : null}
        </div>
      </div>
      <div className={`grid gap-2.5 ${compact ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-3"}`}>
        {items.map((item) => (
          <div
            key={item.label}
            className="border border-[var(--line)] bg-[var(--bg)]/55 px-3 py-2"
          >
            <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
              {item.label}
            </p>
            <p className={`mt-1 text-xs font-semibold leading-snug ${item.accent}`}>
              {item.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Counterfactual Time-Series Chart:
 * Plots actual observations vs. pre-policy counterfactual projection with estimated HAC CIs.
 * Never renders fabricated numbers when series is null.
 */
export function CounterfactualTrajectoryChart({
  series,
  compact = false,
}: {
  series: CounterfactualSeries | null;
  compact?: boolean;
}) {
  if (!series || series.points.length < 3) {
    return (
      <article className="report-chart-card">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#d46a6a]">
          Counterfactual Trajectory · Data Unavailable
        </p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          No live series observations available for counterfactual estimation. Configure <code className="text-[var(--copper)]">FRED_API_KEY</code> or select an active series. Zero fallback numbers are substituted.
        </p>
      </article>
    );
  }

  const pts = series.points;
  const allVals = pts.flatMap((p) => [p.baseline, p.policy, p.lowerBand, p.upperBand]);
  const minV = Math.min(...allVals);
  const maxV = Math.max(...allVals);
  const padRange = (maxV - minV) * 0.08 || 1;
  const lowBound = minV - padRange;
  const highBound = maxV + padRange;
  const range = highBound - lowBound || 1;

  const w = 540;
  const h = compact ? 152 : 172;
  const padL = 42;
  const padR = 18;
  const padT = 18;
  const padB = 26;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const xOf = (idx: number) => padL + (idx / Math.max(1, pts.length - 1)) * plotW;
  const yOf = (val: number) => padT + plotH - ((val - lowBound) / range) * plotH;

  const baseCoords = pts.map((p, i) => ({ x: xOf(i), y: yOf(p.baseline), p }));
  const polCoords = pts.map((p, i) => ({ x: xOf(i), y: yOf(p.policy), p }));

  const basePath = baseCoords
    .map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
    .join(" ");
  const polPath = polCoords
    .map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
    .join(" ");

  const forecastStartIdx = Math.max(0, pts.findIndex((p) => p.isForecast) - 1);
  const fanSlice = pts.slice(forecastStartIdx);
  const upperPoints = fanSlice.map((p, idx) => {
    const i = forecastStartIdx + idx;
    return `${xOf(i).toFixed(1)},${yOf(p.upperBand).toFixed(1)}`;
  });
  const lowerPoints = [...fanSlice].reverse().map((p, idx) => {
    const i = forecastStartIdx + (fanSlice.length - 1 - idx);
    return `${xOf(i).toFixed(1)},${yOf(p.lowerBand).toFixed(1)}`;
  });
  const fanPolygon = [...upperPoints, ...lowerPoints].join(" ");

  const interventionIdx = Math.max(0, pts.findIndex((p) => p.isForecast));
  const interventionX = xOf(interventionIdx);
  const net = series.netPolicyEffectPct;
  const prov = series.provenance;

  return (
    <article className="report-chart-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--copper)]">
              Actual vs. Pre-Policy Counterfactual · {series.units}
            </span>
            <span className="border border-[var(--line)] bg-[var(--bg)]/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-[#8fbf9a]">
              {series.honestyLabel}
            </span>
          </div>
          <h3 className="mt-1 font-[family-name:var(--font-display)] text-base leading-snug text-[var(--ink)]">
            {series.title}
          </h3>
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">{series.subtitle}</p>
        </div>
        <div className="shrink-0 text-right">
          <p
            className={`font-mono text-lg font-semibold ${
              net >= 0 ? "text-[#8fbf9a]" : "text-[#d4a08c]"
            }`}
          >
            β = {net >= 0 ? `+${net}` : `${net}`}
          </p>
          <p className="font-mono text-[10px] text-[var(--muted)]">
            {series.seMethod}
          </p>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${w} ${h}`}
        className={`mt-2.5 w-full ${compact ? "h-36" : "h-44"}`}
        role="img"
        aria-label={`Counterfactual trajectory chart for ${series.title}`}
      >
        {[0, 0.5, 1].map((t) => {
          const gy = padT + t * plotH;
          const val = highBound - t * range;
          return (
            <g key={t}>
              <line
                x1={padL}
                y1={gy}
                x2={w - padR}
                y2={gy}
                stroke="rgba(243,238,228,0.08)"
                strokeDasharray="3 3"
              />
              <text x={4} y={gy + 3} fill="#9a9284" fontSize={8.5}>
                {val.toFixed(1)}
              </text>
            </g>
          );
        })}

        <line
          x1={interventionX}
          y1={padT}
          x2={interventionX}
          y2={padT + plotH}
          stroke="rgba(212,180,131,0.45)"
          strokeDasharray="4 3"
        />
        <text
          x={Math.min(w - 130, interventionX + 5)}
          y={padT + 10}
          fill="#d4b483"
          fontSize={8.5}
          fontWeight={600}
        >
          Policy Date ({series.interventionPeriod.slice(0, 7)}) →
        </text>

        <polygon points={fanPolygon} fill="rgba(143,191,154,0.16)" />

        <path
          d={basePath}
          fill="none"
          stroke="#9a9284"
          strokeWidth={1.6}
          strokeDasharray="5 4"
        />

        <path d={polPath} fill="none" stroke="#8fbf9a" strokeWidth={2.2} />

        {pts.map((pt, idx) =>
          idx === 0 || idx === interventionIdx || idx === pts.length - 1 ? (
            <text
              key={`${pt.period}-${idx}`}
              x={xOf(idx)}
              y={h - 6}
              textAnchor={idx === 0 ? "start" : idx === pts.length - 1 ? "end" : "middle"}
              fill="#9a9284"
              fontSize={9}
            >
              {pt.period.slice(0, 7)}
            </text>
          ) : null,
        )}
      </svg>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] pt-2 text-[10.5px] text-[var(--muted)]">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-[#8fbf9a]" />
            Observed Series ({prov?.seriesId ?? "Live"})
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-3 bg-[#9a9284]" />
            Pre-Policy Counterfactual (+95% HAC CI)
          </span>
        </div>
        {prov ? (
          <span className="font-mono text-[10px]">
            Source: {prov.source.toUpperCase()} · Vintage: {prov.vintageDate ?? "latest"} · SHA-256: {prov.payloadSha256.slice(0, 10)}
          </span>
        ) : null}
      </div>
    </article>
  );
}

/**
 * Jordà Local Projections Impulse-Response Chart with HAC Confidence Bands.
 */
export function ImpulseResponseChart({
  series,
  compact = false,
}: {
  series: ImpulseResponseSeries | null;
  compact?: boolean;
}) {
  if (!series || series.points.length < 2) {
    return null;
  }

  const pts = series.points;
  const allVals = [
    0,
    ...pts.flatMap((p) => [p.priceChannel, p.outputChannel, p.employmentFiscalChannel]),
  ];
  const minV = Math.min(...allVals);
  const maxV = Math.max(...allVals);
  const pad = (maxV - minV) * 0.1 || 1;
  const lowV = minV - pad;
  const highV = maxV + pad;
  const range = highV - lowV || 1;

  const w = 540;
  const h = compact ? 152 : 172;
  const padL = 42;
  const padR = 18;
  const padT = 18;
  const padB = 26;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const xOf = (idx: number) => padL + (idx / Math.max(1, pts.length - 1)) * plotW;
  const yOf = (val: number) => padT + plotH - ((val - lowV) / range) * plotH;
  const zeroY = yOf(0);

  const buildPath = (pick: (p: (typeof pts)[number]) => number) =>
    pts
      .map((p, i) => `${i === 0 ? "M" : "L"} ${xOf(i).toFixed(1)} ${yOf(pick(p)).toFixed(1)}`)
      .join(" ");

  const upperPoly = pts.map((p, i) => `${xOf(i).toFixed(1)},${yOf(p.outputChannel).toFixed(1)}`);
  const lowerPoly = [...pts]
    .reverse()
    .map((p, idx) => {
      const i = pts.length - 1 - idx;
      return `${xOf(i).toFixed(1)},${yOf(p.employmentFiscalChannel).toFixed(1)}`;
    });
  const ciPolygon = [...upperPoly, ...lowerPoly].join(" ");
  const prov = series.provenance;

  return (
    <article className="report-chart-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--copper)]">
              Jordà Local Projections Impulse Response · {series.units}
            </span>
            <span className="border border-[var(--line)] bg-[var(--bg)]/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-[#9bb4d4]">
              {series.honestyLabel}
            </span>
          </div>
          <h3 className="mt-1 font-[family-name:var(--font-display)] text-base leading-snug text-[var(--ink)]">
            {series.title}
          </h3>
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">{series.subtitle}</p>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${w} ${h}`}
        className={`mt-2.5 w-full ${compact ? "h-36" : "h-44"}`}
        role="img"
        aria-label={series.title}
      >
        <line
          x1={padL}
          y1={zeroY}
          x2={w - padR}
          y2={zeroY}
          stroke="rgba(243,238,228,0.25)"
          strokeDasharray="3 3"
        />
        <text x={4} y={zeroY + 3} fill="#9a9284" fontSize={8.5}>
          0
        </text>
        <text x={4} y={padT + 6} fill="#9a9284" fontSize={8.5}>
          {highV.toFixed(1)}
        </text>
        <text x={4} y={padT + plotH} fill="#9a9284" fontSize={8.5}>
          {lowV.toFixed(1)}
        </text>

        <polygon points={ciPolygon} fill="rgba(212,180,131,0.14)" />

        <path
          d={buildPath((p) => p.outputChannel)}
          fill="none"
          stroke="rgba(143,191,154,0.65)"
          strokeWidth={1.3}
          strokeDasharray="4 3"
        />
        <path
          d={buildPath((p) => p.employmentFiscalChannel)}
          fill="none"
          stroke="rgba(155,180,212,0.65)"
          strokeWidth={1.3}
          strokeDasharray="4 3"
        />
        <path
          d={buildPath((p) => p.priceChannel)}
          fill="none"
          stroke="#d4b483"
          strokeWidth={2.2}
        />

        {pts.map((pt, idx) => (
          <text
            key={pt.horizon}
            x={xOf(idx)}
            y={h - 6}
            textAnchor="middle"
            fill="#9a9284"
            fontSize={9}
          >
            {pt.horizon}
          </text>
        ))}
      </svg>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-2 text-[10.5px] text-[var(--muted)]">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-[#d4b483]" />
            {series.channelLabels.price}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-[#8fbf9a]" />
            95% Newey–West HAC Confidence Interval
          </span>
        </div>
        {prov ? (
          <span className="font-mono text-[10px]">
            {prov.source.toUpperCase()} {prov.seriesId} · Vintage {prov.vintageDate ?? "latest"}
          </span>
        ) : null}
      </div>
    </article>
  );
}

/**
 * Specification Curve & Robustness Forest Plot:
 * Shows how the point estimate and 95% CI behave across alternative windows,
 * transforms, controls, and the in-time placebo check.
 */
export function DistributionalIncidenceBarChart({
  items,
  robustness,
}: {
  items: IncidenceBarItem[];
  robustness?: RobustnessBundle | null;
}) {
  if (items.length === 0) return null;
  const maxAbs = Math.max(
    1,
    ...items.map((i) =>
      Math.max(
        Math.abs(i.deltaPct),
        Math.abs(i.confidenceRange[0]),
        Math.abs(i.confidenceRange[1]),
      ),
    ),
  );

  return (
    <article className="report-chart-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--copper)]">
            Automatic Specification Curve & Robustness Checks
          </p>
          <h3 className="mt-0.5 font-[family-name:var(--font-display)] text-base leading-snug text-[var(--ink)]">
            Sensitivity Across Windows, Transforms, Controls & Placebo
          </h3>
          {robustness ? (
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">
              {robustness.summary}
            </p>
          ) : null}
        </div>
        {robustness ? (
          <span
            className={`px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.1em] ${
              robustness.signFlipped
                ? "bg-[#d46a6a]/20 text-[#d46a6a]"
                : "bg-[#8fbf9a]/20 text-[#8fbf9a]"
            }`}
          >
            {robustness.signFlipped
              ? "Sign Flip Flagged"
              : `${Math.round(robustness.passRate * 100)}% Spec Pass Rate`}
          </span>
        ) : null}
      </div>

      <div className="mt-3 space-y-2.5">
        {items.map((item) => {
          const pctWidth = Math.min(48, (Math.abs(item.deltaPct) / maxAbs) * 48);
          const isGain = item.deltaPct >= 0;
          return (
            <div key={item.referenceId || item.stakeholder} className="space-y-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                <span className="truncate font-medium text-[var(--ink)]">
                  {item.stakeholder}{" "}
                  <span className="text-[10.5px] font-normal text-[var(--muted)]">
                    ({item.role})
                  </span>
                </span>
                <span
                  className={`shrink-0 font-mono text-[11px] font-semibold ${
                    isGain ? "text-[#8fbf9a]" : "text-[#d4a08c]"
                  }`}
                >
                  β = {isGain ? `+${item.deltaPct}` : `${item.deltaPct}`}{" "}
                  <span className="text-[9.5px] font-normal text-[var(--muted)]">
                    95% CI [{item.confidenceRange[0]}, {item.confidenceRange[1]}]
                  </span>
                </span>
              </div>

              <div className="relative h-3 w-full bg-[var(--bg)]">
                <div className="absolute left-1/2 top-0 h-full w-px bg-[var(--line)]" />
                <div
                  style={{
                    left: isGain ? "50%" : `${50 - pctWidth}%`,
                    width: `${pctWidth}%`,
                  }}
                  className={`absolute top-0.5 h-2 ${
                    isGain ? "bg-[#8fbf9a]" : "bg-[#d4a08c]"
                  }`}
                />
              </div>

              <p className="font-mono text-[10px] leading-snug text-[var(--muted)]">
                {item.mechanismNote} · Ref: {item.referenceId}
              </p>
            </div>
          );
        })}
      </div>
    </article>
  );
}

/**
 * Event Study Dynamic Leads & Lags Plot + Diagnostics Checklist + Interactive Fork Runner
 */
export function EconometricResultsPanel({
  econModel,
  fredSeries,
}: {
  econModel: RunEconomicModel;
  fredSeries: ExtractedSeries[];
}) {
  const [showMethodsDrawer, setShowMethodsDrawer] = useState(false);
  const [activeForkId, setActiveForkId] = useState<string | null>(null);

  const headline = econModel.headlineEstimate;
  const forks = useMemo(
    () => (headline ? buildDefaultSkepticForks(headline) : []),
    [headline],
  );

  const forkComparison: ForkComparisonResult | null = useMemo(() => {
    if (!headline || !activeForkId || fredSeries.length === 0) return null;
    const forkDef = forks.find((f) => f.id === activeForkId);
    const primary = fredSeries[0];
    if (!forkDef || !primary || primary.points.length < 10) return null;

    const bundle: FetchedSeriesBundle = {
      metadata: {
        provider: headline.provenance.source,
        id: primary.seriesId,
        title: primary.title,
        units: primary.units,
        frequency: headline.provenance.frequency,
        frequencyShort: "unknown",
        seasonalAdjustment: headline.provenance.seasonalAdjustment,
        observationStart: primary.points[0]!.date,
        observationEnd: primary.points[primary.points.length - 1]!.date,
        lastUpdated: headline.provenance.lastUpdated,
        discontinued: false,
        copyrightedThirdParty: headline.provenance.copyrightedThirdParty,
        licenseAttribution: headline.provenance.licenseAttribution,
        sourceUrl: headline.provenance.url,
      },
      observations: primary.points,
      provenance: headline.provenance,
      snapshot: {
        id: `snap_${primary.seriesId}`,
        provider: headline.provenance.source,
        seriesId: primary.seriesId,
        requestUrl: headline.provenance.url,
        retrievedAt: headline.provenance.retrievedAt,
        sha256: headline.provenance.payloadSha256,
        byteLength: primary.points.length * 24,
        rawJson: "[]",
      },
    };

    try {
      return evaluateSpecificationFork({
        baseline: headline,
        outcome: bundle,
        fork: forkDef,
        scopeId: headline.spec.preRegistration.scopeId,
      });
    } catch {
      return null;
    }
  }, [activeForkId, forks, fredSeries, headline]);

  if (!headline) {
    return (
      <section className="border border-[var(--line)] bg-[var(--paper)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#d46a6a]">
              Econometric Estimation Engine · Awaiting Live Series
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {econModel.unavailableReason ??
                "No live series observations are attached to this run yet. Configure FRED_API_KEY and run a query to compute real estimates."}
            </p>
          </div>
          <button
            type="button"
            className="node-action text-[var(--copper)]"
            onClick={() => setShowMethodsDrawer((prev) => !prev)}
          >
            {showMethodsDrawer ? "Hide Methods Drawer" : "Methods & Assumptions Drawer"}
          </button>
        </div>
        {showMethodsDrawer ? <MethodsCatalogDrawer /> : null}
      </section>
    );
  }

  const allEstimates: EconometricEstimate[] = [
    headline,
    ...econModel.secondaryEstimates,
  ];

  return (
    <section className="space-y-4 border border-[var(--line)] bg-[var(--paper)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] pb-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--copper)]">
            Econometric Results, Diagnostics & Specification Forks
          </p>
          <h3 className="mt-0.5 font-[family-name:var(--font-display)] text-lg text-[var(--ink)]">
            Pre-Registered Estimation Table ({headline.spec.outcomeSeriesId})
          </h3>
        </div>
        <button
          type="button"
          className="node-action text-[var(--copper)]"
          onClick={() => setShowMethodsDrawer((prev) => !prev)}
        >
          {showMethodsDrawer ? "Hide Methods Drawer" : "? Methods & Assumptions Drawer"}
        </button>
      </div>

      {showMethodsDrawer ? <MethodsCatalogDrawer /> : null}

      {/* 1. Coefficient Table */}
      <div className="overflow-x-auto border border-[var(--line)]">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-[var(--line)] bg-[var(--bg)]/70 text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">
              <th className="px-3 py-2">Estimator & Honesty Label</th>
              <th className="px-3 py-2">Series & Window</th>
              <th className="px-3 py-2">Point Est. (β)</th>
              <th className="px-3 py-2">Std. Error</th>
              <th className="px-3 py-2">95% CI</th>
              <th className="px-3 py-2">p-value</th>
              <th className="px-3 py-2">N & Lock Hash</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)] font-mono text-[11px]">
            {allEstimates.map((est) => (
              <tr key={est.id} className="bg-[var(--bg)]/35">
                <td className="px-3 py-2 font-sans">
                  <span className="block font-medium text-[var(--ink)]">
                    {est.methodLabel}
                  </span>
                  <span className="text-[10px] text-[var(--copper)]">
                    {est.honestyLabel} · {est.seMethod}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className="block text-[var(--ink)]">
                    {est.spec.outcomeSeriesId}
                  </span>
                  <span className="text-[10px] text-[var(--muted)]">
                    {est.sampleWindow.start} → {est.sampleWindow.end}
                  </span>
                </td>
                <td className="px-3 py-2 font-semibold text-[#8fbf9a]">
                  {est.pointEstimate >= 0 ? `+${est.pointEstimate}` : est.pointEstimate}
                </td>
                <td className="px-3 py-2 text-[var(--ink)]">{est.standardError}</td>
                <td className="px-3 py-2 text-[var(--muted)]">
                  [{est.ciLower}, {est.ciUpper}]
                </td>
                <td className="px-3 py-2 text-[var(--ink)]">{est.pValue}</td>
                <td className="px-3 py-2 text-[10px] text-[var(--muted)]">
                  N={est.sampleSize} · #{est.spec.preRegistration.lockHash.slice(0, 8)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 2. Diagnostics Checklist (Pass / Warn / Fail) */}
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {headline.diagnostics.checklist.map((item) => (
          <div
            key={item.name}
            className="border border-[var(--line)] bg-[var(--bg)]/50 p-2.5"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--ink)]">
                {item.name}
              </span>
              <span
                className={`px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] ${
                  item.status === "pass"
                    ? "bg-[#8fbf9a]/20 text-[#8fbf9a]"
                    : item.status === "warn"
                      ? "bg-[#d4b483]/20 text-[#d4b483]"
                      : "bg-[#d46a6a]/20 text-[#d46a6a]"
                }`}
              >
                {item.status.toUpperCase()}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-snug text-[var(--muted)]">
              {item.summary}
            </p>
          </div>
        ))}
      </div>

      {/* 3. Skeptic "What Would Change My Mind" Interactive Fork Comparison */}
      {forks.length > 0 ? (
        <div className="border border-[var(--line)] bg-[var(--bg)]/45 p-3.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--copper)]">
            Skeptic Red-Team · “What Would Change My Mind” Live Specification Forks
          </p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            Click any falsification fork below to re-estimate live and compare side-by-side against the pre-registered baseline.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {forks.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() =>
                  setActiveForkId((prev) => (prev === f.id ? null : f.id))
                }
                className={`graph-filter-pill ${
                  activeForkId === f.id ? "is-active" : ""
                }`}
              >
                Fork: {f.label}
              </button>
            ))}
          </div>

          {forkComparison ? (
            <div className="mt-3 grid gap-3 border-t border-[var(--line)] pt-3 sm:grid-cols-2">
              <div className="border border-[var(--line)] bg-[var(--paper)] p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
                  Pre-Registered Baseline ({forkComparison.baselineEstimate.methodLabel})
                </p>
                <p className="mt-1 font-mono text-sm font-semibold text-[var(--ink)]">
                  β = {forkComparison.baselineEstimate.pointEstimate} (95% CI [
                  {forkComparison.baselineEstimate.ciLower},{" "}
                  {forkComparison.baselineEstimate.ciUpper}], p ={" "}
                  {forkComparison.baselineEstimate.pValue}, N ={" "}
                  {forkComparison.baselineEstimate.sampleSize})
                </p>
                <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">
                  Lock Hash: #{forkComparison.baselineEstimate.spec.preRegistration.lockHash.slice(0, 12)}
                </p>
              </div>
              <div className="border border-[var(--copper)]/45 bg-[var(--paper)] p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--copper)]">
                  Forked Specification ({forkComparison.fork.label})
                </p>
                <p className="mt-1 font-mono text-sm font-semibold text-[#8fbf9a]">
                  β = {forkComparison.forkEstimate.pointEstimate} (95% CI [
                  {forkComparison.forkEstimate.ciLower},{" "}
                  {forkComparison.forkEstimate.ciUpper}], p ={" "}
                  {forkComparison.forkEstimate.pValue}, N ={" "}
                  {forkComparison.forkEstimate.sampleSize})
                </p>
                <p className="mt-1 text-[11px] text-[var(--ink)]">
                  {forkComparison.conclusionSummary}
                </p>
                <p className="mt-0.5 font-mono text-[10px] text-[var(--muted)]">
                  Fork Hash: #{forkComparison.forkEstimate.spec.preRegistration.lockHash.slice(0, 12)} (parent #{forkComparison.forkEstimate.spec.preRegistration.forkParentHash?.slice(0, 8)})
                </p>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function MethodsCatalogDrawer() {
  const entries = Object.values(METHOD_CATALOG);
  return (
    <div className="grid gap-2.5 border border-[var(--line)] bg-[#0e1015] p-3.5 sm:grid-cols-2 lg:grid-cols-3">
      {entries.map((m) => (
        <div key={m.id} className="border border-[var(--line)] bg-[var(--paper)] p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--copper)]">
              {m.honestyLabel}
            </span>
            <span className="font-mono text-[9.5px] text-[var(--muted)]">
              min N={m.minObservations}
            </span>
          </div>
          <h4 className="mt-1 font-[family-name:var(--font-display)] text-sm text-[var(--ink)]">
            {m.label}
          </h4>
          <p className="mt-1 text-[11px] leading-snug text-[var(--muted)]">
            {m.plainLanguageExplanation}
          </p>
          <p className="mt-1.5 text-[10px] text-[var(--ink)]/85">
            <strong>Assumptions:</strong> {m.assumptions.join("; ")}
          </p>
          <p className="mt-1 text-[10px] text-[#d4a08c]">
            <strong>Threats:</strong> {m.threatsToValidity.join("; ")}
          </p>
        </div>
      ))}
    </div>
  );
}

export function FredSeriesChartCard({ series }: { series: ExtractedSeries }) {
  const pts = series.points;
  if (pts.length < 2) return null;
  const values = pts.map((p) => p.value);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV || 1;
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  const delta = last.value - first.value;
  const pct =
    first.value !== 0 ? ((delta / Math.abs(first.value)) * 100).toFixed(1) : "0.0";

  const w = 520;
  const h = 136;
  const padL = 12;
  const padR = 12;
  const padT = 16;
  const padB = 22;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const coords = pts.map((pt, idx) => {
    const x = padL + (idx / Math.max(1, pts.length - 1)) * plotW;
    const y = padT + plotH - ((pt.value - minV) / range) * plotH;
    return { x, y, date: pt.date, value: pt.value };
  });

  const linePath = coords
    .map((c, idx) => `${idx === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
    .join(" ");
  const areaPath = `${linePath} L ${coords[coords.length - 1]!.x.toFixed(1)} ${(padT + plotH).toFixed(1)} L ${coords[0]!.x.toFixed(1)} ${(padT + plotH).toFixed(1)} Z`;

  return (
    <article className="report-chart-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--copper)]">
            Live Empirical Series · {series.seriesId}
          </p>
          <h3 className="mt-0.5 font-[family-name:var(--font-display)] text-base leading-snug text-[var(--ink)]">
            {series.title}
          </h3>
          {series.units ? (
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">{series.units}</p>
          ) : null}
        </div>
        <div className="text-right">
          <p className="font-mono text-lg font-semibold text-[#8fbf9a]">
            {last.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </p>
          <p className="font-mono text-[10px] text-[var(--muted)]">
            {delta >= 0 ? `+${pct}%` : `${pct}%`} ({first.date} → {last.date}, n={pts.length})
          </p>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="mt-3 h-32 w-full"
        role="img"
        aria-label={`Time-series chart for ${series.title} (${series.seriesId})`}
      >
        <defs>
          <linearGradient id={`grad-${series.key}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8fbf9a" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#8fbf9a" stopOpacity="0.0" />
          </linearGradient>
        </defs>
        <line
          x1={padL}
          y1={padT}
          x2={w - padR}
          y2={padT}
          stroke="rgba(243,238,228,0.08)"
          strokeDasharray="3 3"
        />
        <line
          x1={padL}
          y1={padT + plotH / 2}
          x2={w - padR}
          y2={padT + plotH / 2}
          stroke="rgba(243,238,228,0.08)"
          strokeDasharray="3 3"
        />
        <line
          x1={padL}
          y1={padT + plotH}
          x2={w - padR}
          y2={padT + plotH}
          stroke="rgba(243,238,228,0.14)"
        />
        <path d={areaPath} fill={`url(#grad-${series.key})`} />
        <path d={linePath} fill="none" stroke="#8fbf9a" strokeWidth={2} />
        {coords.map((c, idx) =>
          idx === 0 || idx === coords.length - 1 || idx % 4 === 0 ? (
            <circle key={c.date} cx={c.x} cy={c.y} r={2.6} fill="#d4b483" />
          ) : null,
        )}
        <text x={padL} y={h - 5} fill="#9a9284" fontSize={9.5}>
          {first.date} (min {minV.toLocaleString(undefined, { maximumFractionDigits: 2 })})
        </text>
        <text x={w - padR} y={h - 5} textAnchor="end" fill="#9a9284" fontSize={9.5}>
          {last.date} (max {maxV.toLocaleString(undefined, { maximumFractionDigits: 2 })})
        </text>
      </svg>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] pt-2 text-[10.5px] text-[var(--muted)]">
        <span className="truncate">
          Vintage: {series.vintage ?? series.provenance?.vintageDate ?? "latest"} ·{" "}
          {series.resultHash
            ? `SHA-256: ${series.resultHash.slice(0, 10)}`
            : `Node: ${series.nodeTitle}`}
        </span>
        {series.url ? (
          <a
            href={series.url}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-[var(--copper)] hover:underline"
          >
            Source ↗
          </a>
        ) : null}
      </div>
    </article>
  );
}

export function SpineCoverageChart({ nodes }: { nodes: DigressionNode[] }) {
  if (nodes.length === 0) return null;
  const lanes: PolicyLane[] = [...SPINE_LANES, "digression"];
  const totalSupported = nodes.filter((n) => n.status === "supported").length;
  const supportPct = Math.round((totalSupported / Math.max(1, nodes.length)) * 100);

  return (
    <article className="report-chart-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--copper)]">
            Policy Spine & Evidence Coverage
          </p>
          <h3 className="mt-0.5 font-[family-name:var(--font-display)] text-base text-[var(--ink)]">
            Econometric Standing by Argument Stage
          </h3>
        </div>
        <div className="text-right">
          <p className="font-mono text-lg font-semibold text-[var(--copper)]">
            {supportPct}%
          </p>
          <p className="font-mono text-[10px] text-[var(--muted)]">
            {totalSupported}/{nodes.length} nodes supported
          </p>
        </div>
      </div>

      <div className="mt-3 space-y-2.5">
        {lanes.map((lane) => {
          const laneNodes = nodes.filter((n) => nodeLane(n.kind) === lane);
          const supported = laneNodes.filter(
            (n) => n.status === "supported" || n.status === "data_attached" || n.status === "tested",
          ).length;
          const contested = laneNodes.filter(
            (n) =>
              n.status === "contested" ||
              n.status === "inconclusive" ||
              n.status === "contradicted" ||
              n.status === "unverifiable",
          ).length;
          const proposed = laneNodes.filter(
            (n) =>
              n.status === "proposed",
          ).length;
          const total = Math.max(1, laneNodes.length);

          return (
            <div key={lane} className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="uppercase tracking-[0.1em] text-[var(--ink)]">
                  {lane === "digression" ? "06 · Digression & Forks" : LANE_LABEL[lane]}
                </span>
                <span className="font-mono text-[10px] text-[var(--muted)]">
                  {supported} data/supported · {contested} flagged/inconclusive · {proposed} proposed
                </span>
              </div>
              <div className="flex h-2.5 w-full overflow-hidden bg-[var(--bg)]">
                {supported > 0 ? (
                  <div
                    style={{ width: `${(supported / total) * 100}%` }}
                    className="bg-[#8fbf9a]"
                  />
                ) : null}
                {contested > 0 ? (
                  <div
                    style={{ width: `${(contested / total) * 100}%` }}
                    className="bg-[#d4a08c]"
                  />
                ) : null}
                {proposed > 0 ? (
                  <div
                    style={{ width: `${(proposed / total) * 100}%` }}
                    className="bg-[#d4b483]/50"
                  />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </article>
  );
}

export function IncidenceTradeoffMatrix({
  nodes,
  analyses,
  onOpenNode,
}: {
  nodes: DigressionNode[];
  analyses?: Record<string, NodeAnalysis>;
  onOpenNode?: (id: string) => void;
}) {
  const keyNodes = nodes.filter((n) => n.status !== "pruned");
  if (keyNodes.length === 0) return null;

  return (
    <section className="mt-5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--copper)]">
        Stage-by-Stage Node Analysis, Honesty Labels & Provenance Cards
      </p>
      <div className="mt-2.5 grid gap-3 md:grid-cols-2">
        {keyNodes.map((node) => {
          const kindInfo = NODE_KIND_TAXONOMY[node.kind];
          const statusInfo = NODE_STATUS_TAXONOMY[node.status] ?? NODE_STATUS_TAXONOMY.proposed;
          const fullAnalysis = analyses?.[node.id]?.body;
          return (
            <div
              key={node.id}
              className="border border-[var(--line)] bg-[var(--paper)] p-3.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span
                  className="text-[10px] font-semibold uppercase tracking-[0.12em]"
                  style={{ color: kindInfo.color }}
                >
                  {kindInfo.stage} · {kindInfo.label}
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {node.honestyLabel ? (
                    <span className="border border-[var(--line)] bg-[var(--bg)]/60 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.08em] text-[var(--copper)]">
                      {node.honestyLabel}
                    </span>
                  ) : null}
                  <span
                    className="px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em]"
                    style={{
                      backgroundColor: statusInfo.bgColor,
                      color: statusInfo.color,
                    }}
                    title={node.statusReason ?? statusInfo.meaning}
                  >
                    {statusInfo.shortLabel}
                  </span>
                  {onOpenNode ? (
                    <button
                      type="button"
                      className="node-cite-pill is-interactive"
                      onClick={() => onOpenNode(node.id)}
                    >
                      Inspect ↗
                    </button>
                  ) : (
                    <span className="node-cite-pill">[{shortNodeKey(node.id)}]</span>
                  )}
                </div>
              </div>
              <h4 className="mt-1.5 font-[family-name:var(--font-display)] text-base text-[var(--ink)]">
                {node.title}
              </h4>
              <p className="mt-1 text-xs leading-relaxed text-[var(--ink)]/90">
                {node.body}
              </p>
              {node.statusReason ? (
                <p className="mt-1.5 font-mono text-[10px] text-[var(--muted)]">
                  Rule evaluation: {node.statusReason}
                </p>
              ) : null}
              {fullAnalysis ? (
                <details className="mt-2 border-t border-[var(--line)] pt-2">
                  <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--copper)]">
                    Read 5-Section Economic Analysis (Mechanism, Identification, Incidence, Sign Flip)
                  </summary>
                  <p className="mt-1.5 whitespace-pre-wrap text-[11.5px] leading-relaxed text-[var(--muted)]">
                    {fullAnalysis.replace(/^##\s+/gm, "▸ ")}
                  </p>
                </details>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export type BibliographyEntry = {
  index: number;
  kind: "MCP SPAN" | "CITATION" | "WEB LEAD";
  source: string;
  label: string;
  url?: string;
  spanId?: string;
  nodeTitles: string[];
};

export function collectBibliography(
  nodes: DigressionNode[],
  analyses: Record<string, NodeAnalysis>,
): BibliographyEntry[] {
  const byKey = new Map<string, Omit<BibliographyEntry, "index">>();

  const add = (
    key: string,
    item: Omit<BibliographyEntry, "index" | "nodeTitles">,
    nodeTitle: string,
  ) => {
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.nodeTitles.includes(nodeTitle)) {
        existing.nodeTitles.push(nodeTitle);
      }
      return;
    }
    byKey.set(key, { ...item, nodeTitles: [nodeTitle] });
  };

  for (const node of nodes) {
    for (const chip of node.provenance) {
      if (chip.spanId) {
        add(
          chip.spanId,
          {
            kind: "MCP SPAN",
            source: chip.source,
            label: chip.label,
            url: chip.url,
            spanId: chip.spanId,
          },
          node.title,
        );
      }
    }
  }

  for (const analysis of Object.values(analyses)) {
    for (const citation of analysis.citations) {
      const key = citation.url || citation.title;
      add(
        key,
        {
          kind: "CITATION",
          source: "literature / official",
          label: citation.title,
          url: citation.url,
          spanId: citation.note,
        },
        analysis.title,
      );
    }
  }

  for (const node of nodes) {
    for (const chip of node.provenance) {
      if (!chip.spanId) {
        const key = chip.url || chip.label;
        add(
          key,
          {
            kind: "WEB LEAD",
            source: chip.source,
            label: chip.label,
            url: chip.url,
          },
          node.title,
        );
      }
    }
  }

  return [...byKey.values()].map((entry, idx) => ({
    ...entry,
    index: idx + 1,
  }));
}

export function VerifiedBibliographyTable({
  nodes,
  analyses,
}: {
  nodes: DigressionNode[];
  analyses: Record<string, NodeAnalysis>;
}) {
  const entries = collectBibliography(nodes, analyses);
  if (entries.length === 0) return null;

  return (
    <section className="mt-6 border-t border-[var(--line)] pt-5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--copper)]">
            Full Sourcing & Provenance Register
          </p>
          <h3 className="mt-0.5 font-[family-name:var(--font-display)] text-lg text-[var(--ink)]">
            Verified MCP Spans, Live Series & Literature ({entries.length})
          </h3>
        </div>
      </div>

      <div className="mt-3 overflow-x-auto border border-[var(--line)]">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-[var(--line)] bg-[var(--paper)] text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">
              <th className="px-3 py-2.5">#</th>
              <th className="px-3 py-2.5">Type</th>
              <th className="px-3 py-2.5">Source & Citation</th>
              <th className="px-3 py-2.5">Backed Nodes</th>
              <th className="px-3 py-2.5">Span / SHA-256</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)]">
            {entries.map((entry) => (
              <tr key={`${entry.index}-${entry.label}`} className="bg-[var(--bg)]/40">
                <td className="px-3 py-2.5 font-mono text-[var(--copper)]">
                  [{entry.index}]
                </td>
                <td className="px-3 py-2.5">
                  <span
                    className={`px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] ${
                      entry.kind === "MCP SPAN"
                        ? "bg-[#8fbf9a]/15 text-[#8fbf9a]"
                        : "bg-[var(--paper-strong)] text-[var(--muted)]"
                    }`}
                  >
                    {entry.kind} · {entry.source}
                  </span>
                </td>
                <td className="px-3 py-2.5 font-medium text-[var(--ink)]">
                  {entry.url ? (
                    <a
                      href={entry.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--copper)] hover:underline"
                    >
                      {entry.label} ↗
                    </a>
                  ) : (
                    entry.label
                  )}
                </td>
                <td className="px-3 py-2.5 text-[var(--muted)]">
                  {entry.nodeTitles.join(", ")}
                </td>
                <td className="px-3 py-2.5 font-mono text-[10px] text-[var(--muted)]">
                  {entry.spanId ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
