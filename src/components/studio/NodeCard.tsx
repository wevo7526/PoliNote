"use client";

import type { DigressionNode } from "@/schemas/digression";

type NodeCardProps = {
  node: DigressionNode;
  onOpen: (id: string) => void;
};

export function NodeCard({ node, onOpen }: NodeCardProps) {
  return (
    <button
      type="button"
      onClick={() => onOpen(node.id)}
      className="node-card w-full text-left"
    >
      <div className="flex items-center justify-between gap-3">
        <span className={`kind-tag kind-${node.kind}`}>{node.kind}</span>
        <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
          {node.status}
          {node.confidence !== "unknown" ? ` · ${node.confidence}` : ""}
        </span>
      </div>
      <h3 className="mt-2 font-[family-name:var(--font-display)] text-[1.15rem] leading-snug text-[var(--ink)]">
        {node.title}
      </h3>
      <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-[var(--muted)]">
        {node.body}
      </p>
      <p className="mt-3 text-[11px] uppercase tracking-[0.12em] text-[var(--copper)]">
        {node.agent ? `${node.agent} · ` : ""}Open analysis
      </p>
    </button>
  );
}
