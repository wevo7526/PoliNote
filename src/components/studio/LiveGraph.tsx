"use client";

import { useEffect, useRef, useState } from "react";
import {
  HEADER_Y,
  LANE_LABEL,
  LANE_X,
  NODE_H,
  NODE_W,
  SPINE_LANES,
  layoutPolicyGraph,
} from "@/lib/ai/layout";
import type { DigressionEdge, DigressionNode } from "@/schemas/digression";

type LiveGraphProps = {
  nodes: DigressionNode[];
  edges: DigressionEdge[];
  selectedId: string | null;
  busy?: boolean;
  onOpenNode?: (id: string) => void;
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

function edgeStroke(kind: DigressionEdge["kind"]): { color: string; dash?: string } {
  if (kind === "attacks") return { color: "#d46a6a" };
  if (kind === "alternatives") return { color: "rgba(243,238,228,0.45)", dash: "5 6" };
  if (kind === "depends_on") return { color: "rgba(243,238,228,0.22)" };
  if (kind === "supports" || kind === "causal") return { color: "rgba(212,180,131,0.7)" };
  return { color: "rgba(243,238,228,0.38)" };
}

function statusStroke(node: DigressionNode, fill: string, selected: boolean): {
  color: string;
  width: number;
  dash?: string;
} {
  if (node.status === "contested") return { color: "#d4a08c", width: selected ? 2 : 1.6 };
  if (node.status === "pruned") return { color: "rgba(154,146,132,0.45)", width: 1, dash: "4 4" };
  if (node.status === "supported") return { color: "#8fbf9a", width: selected ? 2 : 1.5 };
  if (selected) return { color: fill, width: 1.8 };
  return { color: fill, width: 1.1 };
}

export function LiveGraph({
  nodes,
  edges,
  selectedId,
  busy = false,
  onOpenNode,
}: LiveGraphProps) {
  const layout = layoutPolicyGraph(nodes, edges);
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

  if (layout.nodes.length === 0) {
    return (
      <div className="live-graph-empty">
        <div className="veil-idle absolute left-1/2 top-1/2 h-[280px] w-[280px] -translate-x-1/2 -translate-y-1/2" />
        <p className="relative text-[12px] uppercase tracking-[0.16em] text-[var(--muted)]">
          {busy ? "Waiting for the first node…" : "Graph will grow here"}
        </p>
      </div>
    );
  }

  const minX = 8;
  const minY = 0;
  const maxX = LANE_X.incidence + NODE_W + 40;
  const maxY = Math.max(layout.bandBottom + 24, 360);
  const width = maxX - minX;
  const height = maxY - minY;
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));

  return (
    <div className="live-graph-canvas">
      <svg
        viewBox={`${minX} ${minY} ${width} ${height}`}
        className="h-full w-full"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Policy digression graph"
      >
        {SPINE_LANES.map((lane) => (
          <text
            key={lane}
            className="graph-lane-label"
            x={LANE_X[lane]}
            y={HEADER_Y}
            fill="#d4b483"
            fontSize={10}
            letterSpacing={1.6}
            style={{ textTransform: "uppercase" }}
          >
            {LANE_LABEL[lane]}
          </text>
        ))}

        <line
          x1={LANE_X.instrument}
          y1={layout.bandTop}
          x2={LANE_X.incidence + NODE_W}
          y2={layout.bandTop}
          stroke="rgba(212,180,131,0.28)"
          strokeWidth={1}
        />
        <text
          className="graph-lane-label"
          x={LANE_X.instrument}
          y={layout.bandTop + 18}
          fill="#9a9284"
          fontSize={10}
          letterSpacing={1.6}
          style={{ textTransform: "uppercase" }}
        >
          {LANE_LABEL.digression}
        </text>
        <rect
          x={LANE_X.instrument - 8}
          y={layout.bandTop + 22}
          width={LANE_X.incidence + NODE_W - LANE_X.instrument + 16}
          height={Math.max(layout.bandBottom - layout.bandTop - 22, 80)}
          fill="rgba(212,180,131,0.03)"
          stroke="rgba(212,180,131,0.08)"
        />

        {edges.map((edge) => {
          const from = byId.get(edge.sourceId);
          const to = byId.get(edge.targetId);
          if (!from || !to) return null;
          const quiet =
            from.status === "pruned" || to.status === "pruned";
          const x1 = from.position.x + NODE_W / 2;
          const y1 = from.position.y + NODE_H / 2;
          const x2 = to.position.x + NODE_W / 2;
          const y2 = to.position.y + NODE_H / 2;
          const mx = (x1 + x2) / 2;
          const stroke = edgeStroke(edge.kind);
          return (
            <path
              key={edge.id}
              className="graph-edge"
              d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
              fill="none"
              stroke={stroke.color}
              strokeWidth={1.4}
              strokeDasharray={stroke.dash}
              opacity={quiet ? 0.22 : 1}
            />
          );
        })}

        {layout.nodes.map((node) => {
          const selected = node.id === selectedId;
          const fill = KIND_FILL[node.kind];
          const ring = statusStroke(node, fill, selected);
          const clickable = Boolean(onOpenNode);
          const arriving = fresh.has(node.id);
          const pruned = node.status === "pruned";
          return (
            <g
              key={node.id}
              className={`graph-node${arriving ? " is-arriving" : ""}${pruned ? " is-pruned" : ""}`}
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              style={{ cursor: clickable ? "pointer" : "default" }}
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
                rx={2}
                fill={selected ? "rgba(212,180,131,0.14)" : "rgba(11,12,15,0.82)"}
                stroke={ring.color}
                strokeWidth={ring.width}
                strokeDasharray={ring.dash}
              />
              <circle
                cx={node.position.x + 14}
                cy={node.position.y + 30}
                r={4}
                fill={fill}
              />
              <text
                x={node.position.x + 26}
                y={node.position.y + 22}
                fill={fill}
                fontSize={9}
                letterSpacing={1.4}
                style={{ textTransform: "uppercase" }}
              >
                {node.kind}
                {node.status !== "proposed" ? ` · ${node.status}` : ""}
              </text>
              <text
                x={node.position.x + 26}
                y={node.position.y + 42}
                fill="#f3eee4"
                fontSize={13}
              >
                {node.title.length > 28 ? `${node.title.slice(0, 28)}…` : node.title}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
