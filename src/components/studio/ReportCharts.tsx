"use client";

import type {
  CounterfactualSeries,
  EconomicScorecard,
  ImpulseResponseSeries,
  IncidenceBarItem,
} from "@/lib/economics/engine";
import { LANE_LABEL, SPINE_LANES, nodeLane, type PolicyLane } from "@/lib/ai/layout";
import {
  NODE_KIND_TAXONOMY,
  NODE_STATUS_TAXONOMY,
} from "@/lib/ui/node-taxonomy";
import { shortNodeKey } from "@/lib/ui/prose";
import type { NodeAnalysis } from "@/schemas/analysis";
import type { DigressionNode } from "@/schemas/digression";

export type ExtractedSeries = {
  key: string;
  seriesId: string;
  title: string;
  units: string;
  url?: string;
  spanId?: string;
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
        nodeTitle: node.title,
        points: chip.seriesPoints,
      });
    }
  }
  return out;
}

export function EconomicScorecardBanner({
  scorecard,
  compact = false,
}: {
  scorecard: EconomicScorecard;
  compact?: boolean;
}) {
  const items = [
    { label: "Policy Instrument Shock", value: scorecard.shockMagnitude, accent: "text-[var(--copper)]" },
    { label: "Net Effect vs. Baseline", value: scorecard.primaryMetricDelta, accent: "text-[#8fbf9a]" },
    { label: "Peak Channel Response", value: scorecard.realOutputDelta, accent: "text-[var(--ink)]" },
    { label: "Elasticity & Pass-Through", value: scorecard.elasticitySummary, accent: "text-[var(--ink)]" },
    { label: "Transmission Horizon", value: scorecard.timeToPeak, accent: "text-[var(--muted)]" },
    { label: "Empirical Standing", value: scorecard.verificationStanding, accent: "text-[#8fbf9a]" },
  ];

  return (
    <div className="border border-[var(--line)] bg-[var(--paper)] p-3.5">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--copper)]">
          Quantitative Economic Analysis Engine · {scorecard.domainLabel}
        </span>
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
 * Counterfactual Time-Series Fan Chart:
 * Plots Historical Actuals (2021-2025) -> Status-Quo Baseline vs. Enacted Policy Trajectory (2026-2030) with 90% CI Fan.
 */
export function CounterfactualTrajectoryChart({
  series,
  compact = false,
}: {
  series: CounterfactualSeries;
  compact?: boolean;
}) {
  const pts = series.points;
  if (pts.length < 3) return null;

  const allVals = pts.flatMap((p) => [p.baseline, p.policy, p.lowerBand, p.upperBand]);
  const minV = Math.min(...allVals) - 1.5;
  const maxV = Math.max(...allVals) + 1.5;
  const range = maxV - minV || 1;

  const w = 540;
  const h = compact ? 148 : 168;
  const padL = 34;
  const padR = 18;
  const padT = 18;
  const padB = 26;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const xOf = (idx: number) => padL + (idx / Math.max(1, pts.length - 1)) * plotW;
  const yOf = (val: number) => padT + plotH - ((val - minV) / range) * plotH;

  const baseCoords = pts.map((p, i) => ({ x: xOf(i), y: yOf(p.baseline), p }));
  const polCoords = pts.map((p, i) => ({ x: xOf(i), y: yOf(p.policy), p }));

  const basePath = baseCoords
    .map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
    .join(" ");
  const polPath = polCoords
    .map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
    .join(" ");

  // Confidence fan polygon over forecast indices (index 4 onwards)
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

  return (
    <article className="report-chart-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--copper)]">
            Counterfactual Time-Series Projection · {series.units}
          </p>
          <h3 className="mt-0.5 font-[family-name:var(--font-display)] text-base leading-snug text-[var(--ink)]">
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
            {net >= 0 ? `+${net}%` : `${net}%`}
          </p>
          <p className="font-mono text-[10px] text-[var(--muted)]">
            Policy vs. Baseline (2030)
          </p>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${w} ${h}`}
        className={`mt-2.5 w-full ${compact ? "h-32" : "h-40"}`}
        role="img"
        aria-label={series.title}
      >
        {/* Horizontal gridlines */}
        {[0, 0.5, 1].map((t) => {
          const gy = padT + t * plotH;
          const val = maxV - t * range;
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
                {val.toFixed(0)}
              </text>
            </g>
          );
        })}

        {/* Policy Intervention vertical marker */}
        <line
          x1={interventionX}
          y1={padT}
          x2={interventionX}
          y2={padT + plotH}
          stroke="rgba(212,180,131,0.45)"
          strokeDasharray="4 3"
        />
        <text
          x={interventionX + 5}
          y={padT + 10}
          fill="#d4b483"
          fontSize={8.5}
          fontWeight={600}
        >
          Policy Enacted ({series.interventionPeriod}) →
        </text>

        {/* 90% CI Fan */}
        <polygon points={fanPolygon} fill="rgba(143,191,154,0.16)" />

        {/* Status-Quo Baseline */}
        <path
          d={basePath}
          fill="none"
          stroke="#9a9284"
          strokeWidth={1.6}
          strokeDasharray="5 4"
        />

        {/* Policy Trajectory */}
        <path d={polPath} fill="none" stroke="#8fbf9a" strokeWidth={2.3} />

        {polCoords.map((c, idx) =>
          idx === 0 || idx === interventionIdx || idx === polCoords.length - 1 ? (
            <circle key={c.p.period} cx={c.x} cy={c.y} r={3} fill="#d4b483" />
          ) : null,
        )}

        {/* X-Axis Period Labels */}
        {pts.map((pt, idx) =>
          idx % 2 === 0 || idx === pts.length - 1 ? (
            <text
              key={pt.period}
              x={xOf(idx)}
              y={h - 6}
              textAnchor="middle"
              fill="#9a9284"
              fontSize={9}
            >
              {pt.period}
            </text>
          ) : null,
        )}
      </svg>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] pt-2 text-[10.5px] text-[var(--muted)]">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-[#8fbf9a]" />
            Policy Path (+90% CI Fan)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-3 bg-[#9a9284]" />
            Status-Quo Baseline
          </span>
        </div>
        <span className="font-mono text-[10px]">
          2030 Policy: {pts[pts.length - 1]?.policy} vs. Baseline: {pts[pts.length - 1]?.baseline}
        </span>
      </div>
    </article>
  );
}

/**
 * Dynamic Impulse-Response Chart (Q+1 to Q+8) across Price, Output, and Labor/Fiscal channels.
 */
export function ImpulseResponseChart({
  series,
  compact = false,
}: {
  series: ImpulseResponseSeries;
  compact?: boolean;
}) {
  const pts = series.points;
  if (pts.length < 2) return null;

  const allVals = [
    0,
    ...pts.flatMap((p) => [p.priceChannel, p.outputChannel, p.employmentFiscalChannel]),
  ];
  const minV = Math.min(...allVals) - 1.2;
  const maxV = Math.max(...allVals) + 1.2;
  const range = maxV - minV || 1;

  const w = 540;
  const h = compact ? 148 : 168;
  const padL = 34;
  const padR = 18;
  const padT = 18;
  const padB = 26;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const xOf = (idx: number) => padL + (idx / Math.max(1, pts.length - 1)) * plotW;
  const yOf = (val: number) => padT + plotH - ((val - minV) / range) * plotH;
  const zeroY = yOf(0);

  const buildPath = (pick: (p: (typeof pts)[number]) => number) =>
    pts
      .map((p, i) => `${i === 0 ? "M" : "L"} ${xOf(i).toFixed(1)} ${yOf(pick(p)).toFixed(1)}`)
      .join(" ");

  return (
    <article className="report-chart-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--copper)]">
            Dynamic Impulse-Response Curves · {series.units}
          </p>
          <h3 className="mt-0.5 font-[family-name:var(--font-display)] text-base leading-snug text-[var(--ink)]">
            {series.title}
          </h3>
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">{series.subtitle}</p>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${w} ${h}`}
        className={`mt-2.5 w-full ${compact ? "h-32" : "h-40"}`}
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
          0%
        </text>
        <text x={4} y={padT + 6} fill="#9a9284" fontSize={8.5}>
          +{maxV.toFixed(1)}%
        </text>
        <text x={4} y={padT + plotH} fill="#9a9284" fontSize={8.5}>
          {minV.toFixed(1)}%
        </text>

        {/* 3 Dynamic Channels */}
        <path
          d={buildPath((p) => p.priceChannel)}
          fill="none"
          stroke="#d4b483"
          strokeWidth={2.1}
        />
        <path
          d={buildPath((p) => p.outputChannel)}
          fill="none"
          stroke="#8fbf9a"
          strokeWidth={2.1}
        />
        <path
          d={buildPath((p) => p.employmentFiscalChannel)}
          fill="none"
          stroke="#9bb4d4"
          strokeWidth={1.9}
          strokeDasharray="4 3"
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

      <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-[var(--line)] pt-2 text-[10.5px] text-[var(--muted)]">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-[#d4b483]" />
          {series.channelLabels.price}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-[#8fbf9a]" />
          {series.channelLabels.output}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-[#9bb4d4]" />
          {series.channelLabels.employmentFiscal}
        </span>
      </div>
    </article>
  );
}

/**
 * Distributional Incidence Diverging Bar Chart:
 * Visualizes quantified welfare/surplus gains and losses across stakeholder groups.
 */
export function DistributionalIncidenceBarChart({
  items,
}: {
  items: IncidenceBarItem[];
}) {
  if (items.length === 0) return null;
  const maxAbs = Math.max(
    8,
    ...items.map((i) => Math.max(Math.abs(i.deltaPct), Math.abs(i.confidenceRange[0]), Math.abs(i.confidenceRange[1]))),
  );

  return (
    <article className="report-chart-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--copper)]">
            Distributional Incidence & Welfare Split
          </p>
          <h3 className="mt-0.5 font-[family-name:var(--font-display)] text-base leading-snug text-[var(--ink)]">
            Who Pays & Who Gains (% Real Income / Surplus Delta)
          </h3>
        </div>
      </div>

      <div className="mt-3 space-y-2.5">
        {items.map((item) => {
          const pctWidth = Math.min(48, (Math.abs(item.deltaPct) / maxAbs) * 48);
          const isGain = item.deltaPct >= 0;
          return (
            <div key={item.stakeholder} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className=" truncate font-medium text-[var(--ink)]">
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
                  {isGain ? `+${item.deltaPct}%` : `${item.deltaPct}%`}{" "}
                  <span className="text-[9.5px] font-normal text-[var(--muted)]">
                    [{item.confidenceRange[0]}%, {item.confidenceRange[1]}%]
                  </span>
                </span>
              </div>

              {/* Diverging bar centered at 50% */}
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

              <p className="text-[10.5px] leading-snug text-[var(--muted)]">
                {item.mechanismNote}
              </p>
            </div>
          );
        })}
      </div>
    </article>
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
            FRED Empirical Series · {series.seriesId}
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
            {delta >= 0 ? `+${pct}%` : `${pct}%`} ({first.date} → {last.date})
          </p>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="mt-3 h-32 w-full"
        role="img"
        aria-label={`Time-series chart for ${series.title}`}
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

      <div className="mt-2 flex items-center justify-between gap-2 border-t border-[var(--line)] pt-2 text-[11px] text-[var(--muted)]">
        <span className="truncate">Supports: {series.nodeTitle}</span>
        {series.url ? (
          <a
            href={series.url}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-[var(--copper)] hover:underline"
          >
            St. Louis Fed ↗
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
            Empirical Graduation by Argument Stage
          </h3>
        </div>
        <div className="text-right">
          <p className="font-mono text-lg font-semibold text-[var(--copper)]">
            {supportPct}%
          </p>
          <p className="font-mono text-[10px] text-[var(--muted)]">
            {totalSupported}/{nodes.length} nodes verified
          </p>
        </div>
      </div>

      <div className="mt-3 space-y-2.5">
        {lanes.map((lane) => {
          const laneNodes = nodes.filter((n) => nodeLane(n.kind) === lane);
          const supported = laneNodes.filter((n) => n.status === "supported").length;
          const contested = laneNodes.filter((n) => n.status === "contested").length;
          const proposed = laneNodes.filter(
            (n) => n.status !== "supported" && n.status !== "contested",
          ).length;
          const total = Math.max(1, laneNodes.length);

          return (
            <div key={lane} className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="uppercase tracking-[0.1em] text-[var(--ink)]">
                  {lane === "digression" ? "06 · Digression Branches" : LANE_LABEL[lane]}
                </span>
                <span className="font-mono text-[10px] text-[var(--muted)]">
                  {supported} verified · {contested} needs proof · {proposed} hypothesis
                </span>
              </div>
              <div className="flex h-2.5 w-full overflow-hidden bg-[var(--bg)]">
                {supported > 0 ? (
                  <div
                    style={{ width: `${(supported / total) * 100}%` }}
                    className="bg-[#8fbf9a]"
                    title={`${supported} verified`}
                  />
                ) : null}
                {contested > 0 ? (
                  <div
                    style={{ width: `${(contested / total) * 100}%` }}
                    className="bg-[#d4a08c]"
                    title={`${contested} needs proof`}
                  />
                ) : null}
                {proposed > 0 ? (
                  <div
                    style={{ width: `${(proposed / total) * 100}%` }}
                    className="bg-[#d4b483]/50"
                    title={`${proposed} hypothesis`}
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
        Stage-by-Stage Node Analysis & Provenance Cards
      </p>
      <div className="mt-2.5 grid gap-3 md:grid-cols-2">
        {keyNodes.map((node) => {
          const kindInfo = NODE_KIND_TAXONOMY[node.kind];
          const statusInfo = NODE_STATUS_TAXONOMY[node.status];
          const fullAnalysis = analyses?.[node.id]?.body;
          return (
            <div
              key={node.id}
              className="border border-[var(--line)] bg-[var(--paper)] p-3.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className="text-[10px] font-semibold uppercase tracking-[0.12em]"
                  style={{ color: kindInfo.color }}
                >
                  {kindInfo.stage} · {kindInfo.label}
                </span>
                <div className="flex items-center gap-2">
                  <span
                    className="px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em]"
                    style={{
                      backgroundColor: statusInfo.bgColor,
                      color: statusInfo.color,
                    }}
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
              {fullAnalysis ? (
                <details className="mt-2 border-t border-[var(--line)] pt-2">
                  <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--copper)]">
                    Read 5-Section Economic Analysis (Mechanism, Incidence, Identification, Sign Flip)
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
            Verified MCP Spans, Official Series & Literature ({entries.length})
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
              <th className="px-3 py-2.5">Span Hash / Note</th>
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
