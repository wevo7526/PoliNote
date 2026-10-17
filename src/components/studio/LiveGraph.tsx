"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { humanAgent } from "@/lib/ai/event-view";
import {
  HEADER_Y,
  LANE_LABEL,
  LANE_SUBTITLE,
  LANE_X,
  NODE_H,
  NODE_W,
  SPINE_LANES,
  SPINE_START_Y,
  layoutPolicyGraph,
  nodeLane,
} from "@/lib/ai/layout";
import type { DigressionEdge, DigressionNode } from "@/schemas/digression";

export type GraphFilterMode =
  | "all"
  | "spine"
  | "digression"
  | "supported"
  | "contested";

type LiveGraphProps = {
  nodes: DigressionNode[];
  edges: DigressionEdge[];
  selectedId: string | null;
  busy?: boolean;
  onOpenNode?: (id: string) => void;
  onQuickPrompt?: (prompt: string) => void;
};

const KIND_FILL: Record<DigressionNode["kind"], string> = {
  claim: "#d4b483",
  mechanism: "#8fbfb0",
  constraint: "#c9a27a",
  evidence: "#9bb4d4",
  counterfactual: "#b5a4d4",
  incidence: "#d4a08c",
  uncertainty: "#a8a29a",
  fork: "#d48ca0",
};

const EDGE_SHORT_LABEL: Record<DigressionEdge["kind"], string> = {
  supports: "supports",
  attacks: "attacks",
  depends_on: "depends on",
  elaborates: "elaborates",
  alternatives: "alt fork",
  causal: "causal →",
};

function edgeStroke(kind: DigressionEdge["kind"]): {
  color: string;
  dash?: string;
  marker: string;
} {
  if (kind === "attacks") {
    return { color: "#d46a6a", marker: "url(#arrow-attack)" };
  }
  if (kind === "alternatives") {
    return { color: "#b5a4d4", dash: "5 5", marker: "url(#arrow-alt)" };
  }
  if (kind === "depends_on") {
    return { color: "rgba(243,238,228,0.42)", dash: "3 4", marker: "url(#arrow-muted)" };
  }
  if (kind === "supports" || kind === "causal") {
    return { color: "#d4b483", marker: "url(#arrow-copper)" };
  }
  return { color: "rgba(243,238,228,0.52)", marker: "url(#arrow-muted)" };
}

function statusStyle(
  node: DigressionNode,
  fill: string,
  selected: boolean,
): {
  stroke: string;
  width: number;
  dash?: string;
  badgeFill: string;
  badgeText: string;
} {
  if (node.status === "supported") {
    return {
      stroke: "#8fbf9a",
      width: selected ? 2.2 : 1.6,
      badgeFill: "rgba(143,191,154,0.18)",
      badgeText: "#8fbf9a",
    };
  }
  if (node.status === "contested") {
    return {
      stroke: "#d4a08c",
      width: selected ? 2.2 : 1.6,
      badgeFill: "rgba(212,160,140,0.18)",
      badgeText: "#d4a08c",
    };
  }
  if (node.status === "pruned") {
    return {
      stroke: "rgba(154,146,132,0.45)",
      width: 1,
      dash: "4 4",
      badgeFill: "rgba(154,146,132,0.14)",
      badgeText: "#9a9284",
    };
  }
  return {
    stroke: selected ? "#d4b483" : fill,
    width: selected ? 2.0 : 1.15,
    badgeFill: "rgba(243,238,228,0.08)",
    badgeText: "#9a9284",
  };
}

function wrapTwoLines(text: string, maxPerLine = 31): [string, string | null] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxPerLine) return [clean, null];
  const words = clean.split(" ");
  let line1 = "";
  let idx = 0;
  while (idx < words.length) {
    const candidate = line1 ? `${line1} ${words[idx]}` : words[idx]!;
    if (candidate.length > maxPerLine && line1.length > 0) break;
    line1 = candidate;
    idx += 1;
  }
  const rest = words.slice(idx).join(" ");
  if (!rest) return [line1.slice(0, maxPerLine), null];
  const line2 =
    rest.length > maxPerLine ? `${rest.slice(0, maxPerLine - 1).trim()}…` : rest;
  return [line1, line2];
}

function computeEdgeGeometry(from: DigressionNode, to: DigressionNode): {
  d: string;
  labelX: number;
  labelY: number;
} {
  const fromCx = from.position.x + NODE_W / 2;
  const fromCy = from.position.y + NODE_H / 2;
  const toCx = to.position.x + NODE_W / 2;
  const toCy = to.position.y + NODE_H / 2;

  const dx = toCx - fromCx;
  const dy = toCy - fromCy;

  // Primarily vertical connection (e.g. spine parent <-> digression band or same column)
  if (Math.abs(dx) < 80 || Math.abs(dy) > Math.abs(dx) * 0.72) {
    const goingDown = dy >= 0;
    const x1 = fromCx;
    const y1 = goingDown ? from.position.y + NODE_H : from.position.y;
    const x2 = toCx;
    const y2 = goingDown ? to.position.y : to.position.y + NODE_H;
    const my = (y1 + y2) / 2;
    return {
      d: `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`,
      labelX: (x1 + x2) / 2,
      labelY: my,
    };
  }

  // Primarily horizontal connection across swimlanes
  const goingRight = dx >= 0;
  const x1 = goingRight ? from.position.x + NODE_W : from.position.x;
  const y1 = fromCy;
  const x2 = goingRight ? to.position.x : to.position.x + NODE_W;
  const y2 = toCy;
  const mx = (x1 + x2) / 2;
  return {
    d: `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`,
    labelX: mx,
    labelY: (y1 + y2) / 2 - 6,
  };
}

const STARTER_PROMPTS = [
  {
    tag: "Trade & Tariffs",
    title: "25% tariff on imported battery-electric vehicles",
    prompt:
      "What are the near-term US price, domestic assembly employment, and tariff revenue effects of a 25% ad valorem tariff on imported battery-electric vehicles?",
  },
  {
    tag: "Housing & Land Use",
    title: "By-right transit-oriented upzoning mandate",
    prompt:
      "Evaluate a state mandate allowing 6-story multifamly housing by-right within 0.5 miles of commuter rail stations: effects on rents, construction permits, and municipal fiscal incidence.",
  },
  {
    tag: "Industrial & Climate",
    title: "Carbon border adjustment on imported steel & aluminum",
    prompt:
      "Assess a carbon border adjustment mechanism (CBAM) on imported steel and aluminum: pass-through to downstream manufacturers, domestic decarbonization incentives, and WTO retaliation risk.",
  },
];

export function LiveGraph({
  nodes,
  edges,
  selectedId,
  busy = false,
  onOpenNode,
  onQuickPrompt,
}: LiveGraphProps) {
  const [filter, setFilter] = useState<GraphFilterMode>("all");
  const [showPruned, setShowPruned] = useState(true);
  const [showLegend, setShowLegend] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const visibleNodes = useMemo(() => {
    return nodes.filter((node) => {
      if (!showPruned && node.status === "pruned") return false;
      if (filter === "spine") return nodeLane(node.kind) !== "digression";
      if (filter === "digression") return nodeLane(node.kind) === "digression";
      if (filter === "supported") return node.status === "supported";
      if (filter === "contested") return node.status === "contested";
      return true;
    });
  }, [nodes, filter, showPruned]);

  const layout = useMemo(
    () => layoutPolicyGraph(visibleNodes, edges),
    [visibleNodes, edges],
  );

  const seenRef = useRef<Set<string>>(new Set());
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const runId = nodes[0]?.runId ?? "";

  useEffect(() => {
    seenRef.current = new Set();
    setFresh(new Set());
  }, [runId]);

  const nodeKey = nodes.map((node) => node.id).join("|");
  useEffect(() => {
    const arrived = new Set<string>();
    for (const node of nodes) {
      if (!seenRef.current.has(node.id)) arrived.add(node.id);
    }
    for (const node of nodes) seenRef.current.add(node.id);
    if (arrived.size === 0) return;
    setFresh(arrived);
    const timer = window.setTimeout(() => setFresh(new Set()), 1400);
    return () => window.clearTimeout(timer);
  }, [nodeKey, nodes]);

  const focusNodeId = hoveredId ?? selectedId;
  const connectedIds = useMemo(() => {
    if (!focusNodeId) return null;
    const set = new Set<string>([focusNodeId]);
    for (const edge of edges) {
      if (edge.sourceId === focusNodeId) set.add(edge.targetId);
      if (edge.targetId === focusNodeId) set.add(edge.sourceId);
    }
    return set;
  }, [focusNodeId, edges]);

  if (nodes.length === 0) {
    return (
      <div className="live-graph-empty flex-col gap-5 p-6">
        <div className="veil-idle pointer-events-none absolute left-1/2 top-1/2 h-[320px] w-[320px] -translate-x-1/2 -translate-y-1/2" />
        <div className="relative z-10 max-w-xl text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--copper)]">
            {busy ? "Crew assembling policy spine…" : "Policy Digression Blueprint"}
          </p>
          <h3 className="mt-2 font-[family-name:var(--font-display)] text-2xl tracking-tight text-[var(--ink)]">
            {busy
              ? "Locking scope contract and placing spine nodes"
              : "Every policy question maps onto 5 spine stages + digressions"}
          </h3>
          <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
            01 Instrument → 02 Mechanism → 03 Claim / Target → 04 Identification → 05 Incidence, with Forks, Counterfactuals, and Uncertainties branched below.
          </p>
        </div>

        {!busy && onQuickPrompt ? (
          <div className="relative z-10 grid w-full max-w-2xl gap-2.5 sm:grid-cols-3">
            {STARTER_PROMPTS.map((item) => (
              <button
                key={item.title}
                type="button"
                onClick={() => onQuickPrompt(item.prompt)}
                className="starter-card text-left"
              >
                <span className="block text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--copper)]">
                  {item.tag}
                </span>
                <span className="mt-1.5 block font-[family-name:var(--font-display)] text-sm leading-snug text-[var(--ink)]">
                  {item.title}
                </span>
                <span className="mt-2 block text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">
                  Run digression →
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  const minX = 16;
  const minY = 0;
  const maxX = LANE_X.incidence + NODE_W + 32;
  const maxY = Math.max(layout.bandBottom + 28, 420);
  const baseWidth = maxX - minX;
  const baseHeight = maxY - minY;
  const viewWidth = baseWidth / zoom;
  const viewHeight = baseHeight / zoom;
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));

  const supportedCount = nodes.filter((n) => n.status === "supported").length;
  const contestedCount = nodes.filter((n) => n.status === "contested").length;

  return (
    <div className="live-graph-canvas flex-col">
      <div className="graph-toolbar">
        <div className="flex flex-wrap items-center gap-1">
          {(
            [
              { id: "all", label: `All (${nodes.length})` },
              {
                id: "spine",
                label: `Spine (${nodes.filter((n) => nodeLane(n.kind) !== "digression").length})`,
              },
              {
                id: "digression",
                label: `Digressions (${nodes.filter((n) => nodeLane(n.kind) === "digression").length})`,
              },
              { id: "supported", label: `Supported (${supportedCount})` },
              { id: "contested", label: `Contested (${contestedCount})` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={`graph-filter-pill ${filter === tab.id ? "is-active" : ""}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            className="graph-tool-btn"
            onClick={() => setZoom((z) => Math.max(0.75, +(z - 0.15).toFixed(2)))}
            title="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            className="graph-tool-btn"
            onClick={() => setZoom(1)}
            title="Reset zoom to fit"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            className="graph-tool-btn"
            onClick={() => setZoom((z) => Math.min(1.6, +(z + 0.15).toFixed(2)))}
            title="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            className={`graph-tool-btn ${!showPruned ? "is-active" : ""}`}
            onClick={() => setShowPruned((p) => !p)}
          >
            {showPruned ? "Hide pruned" : "Show pruned"}
          </button>
          <button
            type="button"
            className={`graph-tool-btn ${showLegend ? "is-active" : ""}`}
            onClick={() => setShowLegend((l) => !l)}
          >
            Legend
          </button>
        </div>
      </div>

      {showLegend ? (
        <div className="graph-legend-bar">
          <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--copper)]">
            Status & Edges:
          </span>
          <span className="legend-item">
            <span className="legend-dot bg-[#8fbf9a]" /> Supported (≥1 MCP span)
          </span>
          <span className="legend-item">
            <span className="legend-dot bg-[#d4a08c]" /> Contested (needs span / critic flag)
          </span>
          <span className="legend-item">
            <span className="legend-dot bg-[#d4b483]" /> Supports / Causal edge
          </span>
          <span className="legend-item">
            <span className="legend-dot bg-[#d46a6a]" /> Attacks edge
          </span>
          <span className="legend-item">
            <span className="legend-dot bg-[#b5a4d4]" /> Alternative / Counterfactual
          </span>
        </div>
      ) : null}

      <div className="relative min-h-0 w-full flex-1 overflow-auto">
        <svg
          viewBox={`${minX} ${minY} ${viewWidth} ${viewHeight}`}
          className="h-full min-h-[380px] w-full"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Policy digression graph"
        >
          <defs>
            <marker
              id="arrow-copper"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#d4b483" />
            </marker>
            <marker
              id="arrow-attack"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#d46a6a" />
            </marker>
            <marker
              id="arrow-alt"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#b5a4d4" />
            </marker>
            <marker
              id="arrow-muted"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" fill="rgba(243,238,228,0.52)" />
            </marker>
          </defs>

          {/* Swimlane Column Frames */}
          {SPINE_LANES.map((lane) => {
            const x = LANE_X[lane];
            const count = layout.laneCounts[lane];
            return (
              <g key={lane}>
                <rect
                  x={x - 10}
                  y={8}
                  width={NODE_W + 20}
                  height={layout.spineBottom - 8}
                  rx={3}
                  fill="rgba(243,238,228,0.018)"
                  stroke="rgba(243,238,228,0.07)"
                  strokeWidth={1}
                />
                <text
                  className="graph-lane-label"
                  x={x}
                  y={HEADER_Y}
                  fill="#d4b483"
                  fontSize={10}
                  fontWeight={600}
                  letterSpacing={1.5}
                  style={{ textTransform: "uppercase" }}
                >
                  {LANE_LABEL[lane]}
                </text>
                <text
                  x={x + NODE_W}
                  y={HEADER_Y}
                  textAnchor="end"
                  fill="#9a9284"
                  fontSize={9.5}
                >
                  {count}
                </text>
                <text
                  x={x}
                  y={HEADER_Y + 15}
                  fill="rgba(154,146,132,0.78)"
                  fontSize={9.5}
                >
                  {LANE_SUBTITLE[lane]}
                </text>
                <line
                  x1={x - 10}
                  y1={SPINE_START_Y - 10}
                  x2={x + NODE_W + 10}
                  y2={SPINE_START_Y - 10}
                  stroke="rgba(243,238,228,0.07)"
                  strokeWidth={1}
                />
              </g>
            );
          })}

          {/* Digression Band Frame */}
          <rect
            x={LANE_X.instrument - 10}
            y={layout.bandTop}
            width={LANE_X.incidence + NODE_W - LANE_X.instrument + 20}
            height={Math.max(layout.bandBottom - layout.bandTop + 8, 108)}
            rx={3}
            fill="rgba(212,180,131,0.025)"
            stroke="rgba(212,180,131,0.16)"
            strokeDasharray="4 4"
          />
          <text
            className="graph-lane-label"
            x={LANE_X.instrument}
            y={layout.bandTop + 20}
            fill="#d4b483"
            fontSize={10}
            fontWeight={600}
            letterSpacing={1.5}
            style={{ textTransform: "uppercase" }}
          >
            {LANE_LABEL.digression}
          </text>
          <text
            x={LANE_X.incidence + NODE_W}
            y={layout.bandTop + 20}
            textAnchor="end"
            fill="#9a9284"
            fontSize={9.5}
          >
            {layout.digressionCount} branch{layout.digressionCount === 1 ? "" : "es"}
          </text>

          {/* Edges + Semantic Midpoint Pills */}
          {edges.map((edge) => {
            const from = byId.get(edge.sourceId);
            const to = byId.get(edge.targetId);
            if (!from || !to) return null;
            const quiet = from.status === "pruned" || to.status === "pruned";
            const dimmed =
              connectedIds !== null &&
              !(connectedIds.has(from.id) && connectedIds.has(to.id));
            const highlighted =
              focusNodeId !== null &&
              (edge.sourceId === focusNodeId || edge.targetId === focusNodeId);

            const geom = computeEdgeGeometry(from, to);
            const stroke = edgeStroke(edge.kind);
            const labelText = edge.label || EDGE_SHORT_LABEL[edge.kind];
            const pillW = Math.max(46, labelText.length * 5.6 + 12);

            return (
              <g
                key={edge.id}
                className="graph-edge"
                opacity={quiet ? 0.2 : dimmed ? 0.22 : 1}
              >
                <path
                  d={geom.d}
                  fill="none"
                  stroke={stroke.color}
                  strokeWidth={highlighted ? 2.1 : 1.45}
                  strokeDasharray={stroke.dash}
                  markerEnd={stroke.marker}
                />
                <rect
                  x={geom.labelX - pillW / 2}
                  y={geom.labelY - 8}
                  width={pillW}
                  height={15}
                  rx={2}
                  fill="rgba(11,12,15,0.9)"
                  stroke={stroke.color}
                  strokeWidth={0.7}
                />
                <text
                  x={geom.labelX}
                  y={geom.labelY + 2.5}
                  textAnchor="middle"
                  fill={stroke.color}
                  fontSize={8.5}
                  letterSpacing={0.8}
                  style={{ textTransform: "uppercase" }}
                >
                  {labelText.slice(0, 16)}
                </text>
              </g>
            );
          })}

          {/* Rich Multi-Line Node Cards */}
          {layout.nodes.map((node) => {
            const selected = node.id === selectedId;
            const fill = KIND_FILL[node.kind];
            const style = statusStyle(node, fill, selected);
            const clickable = Boolean(onOpenNode);
            const arriving = fresh.has(node.id);
            const pruned = node.status === "pruned";
            const dimmed = connectedIds !== null && !connectedIds.has(node.id);
            const [line1, line2] = wrapTwoLines(node.title, 31);
            const spanCount = node.evidenceSpanIds.length;
            const roleLabel = humanAgent(node.agent);
            const statusLabel = node.status.toUpperCase();
            const statusW = Math.max(54, statusLabel.length * 5.8 + 12);

            return (
              <g
                key={node.id}
                className={`graph-node${arriving ? " is-arriving" : ""}${pruned ? " is-pruned" : ""}`}
                role={clickable ? "button" : undefined}
                tabIndex={clickable ? 0 : undefined}
                style={{
                  cursor: clickable ? "pointer" : "default",
                  opacity: pruned ? 0.38 : dimmed ? 0.28 : 1,
                }}
                onMouseEnter={() => setHoveredId(node.id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={() => onOpenNode?.(node.id)}
                onKeyDown={(event) => {
                  if (!onOpenNode) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpenNode(node.id);
                  }
                }}
              >
                <rect
                  x={node.position.x}
                  y={node.position.y}
                  width={NODE_W}
                  height={NODE_H}
                  rx={3}
                  fill={selected ? "rgba(212,180,131,0.14)" : "rgba(13,15,20,0.92)"}
                  stroke={style.stroke}
                  strokeWidth={style.width}
                  strokeDasharray={style.dash}
                />

                {/* Left accent bar */}
                <rect
                  x={node.position.x}
                  y={node.position.y}
                  width={3.5}
                  height={NODE_H}
                  rx={1.5}
                  fill={fill}
                />

                {/* Top header: kind + status pill */}
                <circle
                  cx={node.position.x + 14}
                  cy={node.position.y + 16}
                  r={3.5}
                  fill={fill}
                />
                <text
                  x={node.position.x + 23}
                  y={node.position.y + 19}
                  fill={fill}
                  fontSize={9}
                  fontWeight={600}
                  letterSpacing={1.3}
                  style={{ textTransform: "uppercase" }}
                >
                  {node.kind}
                </text>

                <rect
                  x={node.position.x + NODE_W - statusW - 8}
                  y={node.position.y + 8}
                  width={statusW}
                  height={15}
                  rx={2}
                  fill={style.badgeFill}
                />
                <text
                  x={node.position.x + NODE_W - statusW / 2 - 8}
                  y={node.position.y + 18.5}
                  textAnchor="middle"
                  fill={style.badgeText}
                  fontSize={8}
                  fontWeight={600}
                  letterSpacing={1}
                >
                  {statusLabel}
                </text>

                {/* Two-line title */}
                <text
                  x={node.position.x + 14}
                  y={node.position.y + 40}
                  fill="#f3eee4"
                  fontSize={12.5}
                  fontWeight={500}
                >
                  {line1}
                </text>
                {line2 ? (
                  <text
                    x={node.position.x + 14}
                    y={node.position.y + 56}
                    fill="#f3eee4"
                    fontSize={12.5}
                    fontWeight={500}
                  >
                    {line2}
                  </text>
                ) : (
                  <text
                    x={node.position.x + 14}
                    y={node.position.y + 56}
                    fill="#9a9284"
                    fontSize={10.5}
                  >
                    {node.body.length > 36
                      ? `${node.body.slice(0, 36).trim()}…`
                      : node.body}
                  </text>
                )}

                {/* Bottom metadata footer: role + confidence + MCP spans */}
                <line
                  x1={node.position.x + 12}
                  y1={node.position.y + 66}
                  x2={node.position.x + NODE_W - 10}
                  y2={node.position.y + 66}
                  stroke="rgba(243,238,228,0.08)"
                  strokeWidth={1}
                />
                <text
                  x={node.position.x + 14}
                  y={node.position.y + 79}
                  fill="#9a9284"
                  fontSize={8.5}
                  letterSpacing={0.9}
                  style={{ textTransform: "uppercase" }}
                >
                  {roleLabel} · {node.confidence}
                </text>
                <text
                  x={node.position.x + NODE_W - 10}
                  y={node.position.y + 79}
                  textAnchor="end"
                  fill={spanCount > 0 ? "#8fbf9a" : "#9a9284"}
                  fontSize={8.5}
                  fontWeight={spanCount > 0 ? 600 : 400}
                  letterSpacing={0.8}
                  style={{ textTransform: "uppercase" }}
                >
                  {spanCount > 0
                    ? `✓ ${spanCount} MCP span${spanCount === 1 ? "" : "s"}`
                    : node.provenance.length > 0
                      ? `${node.provenance.length} web lead${node.provenance.length === 1 ? "" : "s"}`
                      : "unverified"}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
