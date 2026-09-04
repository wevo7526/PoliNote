"use client";

import { layoutNodes } from "@/lib/ai/layout";
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

export function LiveGraph({
  nodes,
  edges,
  selectedId,
  busy = false,
  onOpenNode,
}: LiveGraphProps) {
  const laidOut = layoutNodes(nodes);

  if (laidOut.length === 0) {
    return (
      <div className="live-graph-empty">
        <div className="veil-idle absolute left-1/2 top-1/2 h-[280px] w-[280px] -translate-x-1/2 -translate-y-1/2" />
        <p className="relative text-[12px] uppercase tracking-[0.16em] text-[var(--muted)]">
          {busy ? "Waiting for the first node…" : "Graph will grow here"}
        </p>
      </div>
    );
  }

  const xs = laidOut.map((node) => node.position.x);
  const ys = laidOut.map((node) => node.position.y);
  const minX = Math.min(...xs) - 36;
  const minY = Math.min(...ys) - 36;
  const maxX = Math.max(...xs) + 300;
  const maxY = Math.max(...ys) + 92;
  const width = Math.max(720, maxX - minX);
  const height = Math.max(360, maxY - minY);
  const byId = new Map(laidOut.map((node) => [node.id, node]));

  return (
    <div className="live-graph-canvas">
      <svg
        viewBox={`${minX} ${minY} ${width} ${height}`}
        className="h-full w-full"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Digression graph"
      >
        {edges.map((edge) => {
          const from = byId.get(edge.sourceId);
          const to = byId.get(edge.targetId);
          if (!from || !to) return null;
          const x1 = from.position.x + 130;
          const y1 = from.position.y + 30;
          const x2 = to.position.x + 130;
          const y2 = to.position.y + 30;
          const mx = (x1 + x2) / 2;
          const attack = edge.kind === "attacks";
          return (
            <path
              key={edge.id}
              className="graph-edge"
              d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
              fill="none"
              stroke={attack ? "#d46a6a" : "rgba(243,238,228,0.38)"}
              strokeWidth={1.4}
              strokeDasharray={edge.kind === "alternatives" ? "5 6" : undefined}
            />
          );
        })}
        {laidOut.map((node) => {
          const selected = node.id === selectedId;
          const fill = KIND_FILL[node.kind];
          const clickable = Boolean(onOpenNode);
          return (
            <g
              key={node.id}
              className="graph-node"
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
                width={260}
                height={60}
                rx={2}
                fill={selected ? "rgba(212,180,131,0.14)" : "rgba(11,12,15,0.82)"}
                stroke={fill}
                strokeWidth={selected ? 1.8 : 1.1}
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
