"use client";

import { useEffect, useId, useRef } from "react";
import { AnalysisBody } from "@/components/studio/AnalysisBody";
import { NodeActions } from "@/components/studio/NodeActions";
import { shortNodeKey } from "@/lib/ui/prose";
import type { NodeAnalysis } from "@/schemas/analysis";
import type { DigressionNode, UserNodeStatus } from "@/schemas/digression";

type AnalysisModalProps = {
  node: DigressionNode;
  analysis: NodeAnalysis | null;
  allNodes?: DigressionNode[];
  onClose: () => void;
  onOpenNode?: (id: string) => void;
  onSetStatus?: (nodeId: string, status: UserNodeStatus) => void;
  onDigress?: (node: DigressionNode) => void;
  statusBusy?: boolean;
};

export function AnalysisModal({
  node,
  analysis,
  allNodes,
  onClose,
  onOpenNode,
  onSetStatus,
  onDigress,
  statusBusy = false,
}: AnalysisModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement;
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [onClose]);

  const seriesChips = node.provenance.filter(
    (chip) => chip.seriesPoints && chip.seriesPoints.length >= 2,
  );

  return (
    <div className="modal-root" role="presentation" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="modal-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <p className={`kind-tag kind-${node.kind}`}>{node.kind}</p>
              <span className="font-mono text-[10px] text-[var(--muted)]">
                [{shortNodeKey(node.id)}]
              </span>
            </div>
            <h2
              id={titleId}
              className="mt-2 font-[family-name:var(--font-display)] text-2xl leading-tight"
            >
              {analysis?.title ?? node.title}
            </h2>
            <p className="mt-2 text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">
              {node.status} · confidence {node.confidence}
              {node.agent ? ` · ${node.agent}` : ""}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {onSetStatus ? (
                <NodeActions
                  node={node}
                  disabled={statusBusy}
                  onSetStatus={onSetStatus}
                />
              ) : null}
              {onDigress ? (
                <button
                  type="button"
                  className="node-action text-[var(--copper)]"
                  onClick={() => {
                    onDigress(node);
                    onClose();
                  }}
                >
                  + Digress on this node
                </button>
              ) : null}
            </div>
          </div>
          <button type="button" className="modal-close" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="modal-body">
          {seriesChips.length > 0 ? (
            <div className="mb-5 space-y-3">
              {seriesChips.map((chip, idx) => {
                const pts = chip.seriesPoints ?? [];
                const values = pts.map((p) => p.value);
                const minV = Math.min(...values);
                const maxV = Math.max(...values);
                const range = maxV - minV || 1;
                const w = 520;
                const h = 96;
                const coords = pts.map((pt, i) => {
                  const x = 12 + (i / Math.max(1, pts.length - 1)) * (w - 24);
                  const y = h - 16 - ((pt.value - minV) / range) * (h - 32);
                  return `${x.toFixed(1)},${y.toFixed(1)}`;
                });
                const latest = pts[pts.length - 1];
                const earliest = pts[0];
                return (
                  <div
                    key={`${chip.spanId ?? idx}`}
                    className="border border-[var(--line)] bg-[var(--paper)] p-3"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-[var(--copper)]">
                        {chip.seriesTitle || chip.seriesId || chip.label}
                      </span>
                      <span className="font-mono text-[11px] text-[#8fbf9a]">
                        Latest: {latest?.value} {chip.units ?? ""} ({latest?.date})
                      </span>
                    </div>
                    <svg
                      viewBox={`0 0 ${w} ${h}`}
                      className="mt-2 h-24 w-full"
                      role="img"
                      aria-label={`Time series for ${chip.seriesId ?? chip.label}`}
                    >
                      <polyline
                        fill="none"
                        stroke="#8fbf9a"
                        strokeWidth="2"
                        points={coords.join(" ")}
                      />
                    </svg>
                    <div className="flex justify-between font-mono text-[10px] text-[var(--muted)]">
                      <span>
                        {earliest?.date} (min {minV.toFixed(2)})
                      </span>
                      <span>
                        {latest?.date} (max {maxV.toFixed(2)})
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          <AnalysisBody
            text={analysis?.body ?? node.body}
            nodes={allNodes}
            onOpenNode={onOpenNode}
          />

          {node.provenance.some((chip) => chip.spanId) ? (
            <div className="mt-6">
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--copper)]">
                MCP spans ({node.provenance.filter((c) => c.spanId).length})
              </h3>
              <ul className="mt-2 space-y-2 text-sm">
                {node.provenance
                  .filter((chip) => chip.spanId)
                  .map((chip) => (
                    <li key={chip.spanId}>
                      {chip.url ? (
                        <a
                          href={chip.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[var(--copper)] underline-offset-2 hover:underline"
                        >
                          {chip.label}
                        </a>
                      ) : (
                        <span>{chip.label}</span>
                      )}
                      <p className="mt-0.5 font-mono text-[11px] text-[var(--muted)]">
                        {chip.spanId}
                      </p>
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}

          {analysis && analysis.citations.length > 0 ? (
            <div className="mt-6">
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--copper)]">
                Sources
              </h3>
              <ul className="mt-2 space-y-2 text-sm">
                {analysis.citations.map((citation) => (
                  <li key={`${citation.title}-${citation.url ?? ""}`}>
                    {citation.url ? (
                      <a
                        href={citation.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[var(--copper)] underline-offset-2 hover:underline"
                      >
                        {citation.title}
                      </a>
                    ) : (
                      <span>{citation.title}</span>
                    )}
                    {citation.note ? (
                      <p className="mt-0.5 text-[13px] text-[var(--muted)]">{citation.note}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="mt-6 font-mono text-[10px] text-[var(--muted)]">{node.id}</p>
        </div>
      </div>
    </div>
  );
}
