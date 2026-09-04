"use client";

import { NODE_H, NODE_W, layoutPolicyGraph } from "@/lib/ai/layout";
import type { DigressionEdge, DigressionNode } from "@/schemas/digression";

type GraphVeilProps = {
  nodes: DigressionNode[];
  edges: DigressionEdge[];
  selectedId: string | null;
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

export function GraphVeil({ nodes, edges, selectedId }: GraphVeilProps) {
  if (nodes.length === 0) {
    return (
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="veil-idle absolute left-1/2 top-[38%] h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2" />
      </div>
    );
  }

  const layout = layoutPolicyGraph(nodes, edges);
  const xs = layout.nodes.map((node) => node.position.x);
  const ys = layout.nodes.map((node) => node.position.y);
  const minX = Math.min(...xs) - 40;
  const minY = Math.min(...ys) - 40;
  const maxX = Math.max(...xs) + NODE_W + 40;
  const maxY = Math.max(layout.bandBottom, ...ys) + 40;
  const width = Math.max(800, maxX - minX);
  const height = Math.max(520, maxY - minY);
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <svg
        viewBox={`${minX} ${minY} ${width} ${height}`}
        className="h-full w-full opacity-[0.38]"
        preserveAspectRatio="xMidYMid slice"
      >
        {edges.map((edge) => {
          const from = byId.get(edge.sourceId);
          const to = byId.get(edge.targetId);
          if (!from || !to) return null;
          const x1 = from.position.x + NODE_W / 2;
          const y1 = from.position.y + NODE_H / 2;
          const x2 = to.position.x + NODE_W / 2;
          const y2 = to.position.y + NODE_H / 2;
          const mx = (x1 + x2) / 2;
          const attack = edge.kind === "attacks";
          return (
            <path
              key={edge.id}
              d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
              fill="none"
              stroke={attack ? "#d46a6a" : "rgba(243,238,228,0.45)"}
              strokeWidth={1.2}
              strokeDasharray={edge.kind === "alternatives" ? "5 6" : undefined}
            />
          );
        })}
        {layout.nodes.map((node) => {
          const selected = node.id === selectedId;
          return (
            <g key={node.id}>
              <rect
                x={node.position.x}
                y={node.position.y}
                width={NODE_W}
                height={NODE_H}
                rx={2}
                fill="rgba(11,12,15,0.35)"
                stroke={KIND_FILL[node.kind]}
                strokeWidth={selected ? 1.8 : 0.9}
                opacity={node.status === "pruned" ? 0.28 : selected ? 0.95 : 0.55}
              />
              <circle
                cx={node.position.x + 14}
                cy={node.position.y + NODE_H / 2}
                r={4}
                fill={KIND_FILL[node.kind]}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
