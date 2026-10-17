"use client";

import { useEffect, useId, useMemo, useRef } from "react";
import { AnalysisBody } from "@/components/studio/AnalysisBody";
import { NodeActions } from "@/components/studio/NodeActions";
import {
  EDGE_KIND_TAXONOMY,
  NODE_KIND_TAXONOMY,
  buildNodeProvenanceTrace,
} from "@/lib/ui/node-taxonomy";
import type { NodeAnalysis } from "@/schemas/analysis";
import type {
  DigressionEdge,
  DigressionNode,
  UserNodeStatus,
} from "@/schemas/digression";
import type { RunEvent } from "@/schemas/run-event";

type AnalysisModalProps = {
  node: DigressionNode;
  analysis: NodeAnalysis | null;
  allNodes?: DigressionNode[];
  edges?: DigressionEdge[];
  events?: RunEvent[];
  onClose: () => void;
  onOpenNode?: (id: string) => void;
  onSetStatus?: (nodeId: string, status: UserNodeStatus) => void;
  onDigress?: (node: DigressionNode) => void;
  statusBusy?: boolean;
};

export function AnalysisModal({
  node,
  analysis,
  allNodes = [],
  edges = [],
  events = [],
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

  const trace = useMemo(
    () => buildNodeProvenanceTrace(node, allNodes, edges, events),
    [node, allNodes, edges, events],
  );

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
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]"
                style={{
                  backgroundColor: `${trace.kindInfo.color}22`,
                  color: trace.kindInfo.color,
                }}
              >
                {trace.kindInfo.label}
              </span>
              <span
                className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]"
                style={{
                  backgroundColor: trace.statusInfo.bgColor,
                  color: trace.statusInfo.color,
                }}
              >
                {trace.statusInfo.label}
              </span>
            </div>
            <h2
              id={titleId}
              className="mt-2.5 font-[family-name:var(--font-display)] text-2xl leading-tight"
            >
              {analysis?.title ?? node.title}
            </h2>
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
                  + Branch / Digress from this node
                </button>
              ) : null}
            </div>
          </div>
          <button type="button" className="modal-close" onClick={onClose}>
            Close
          </button>
        </div>

        {/* Plain-English Explainer: What This Node Is & How It Was Made */}
        <div className="mt-4 grid gap-3 border border-[var(--line)] bg-[var(--paper)] p-3.5 sm:grid-cols-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--copper)]">
              What This Node Type Means
            </p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--ink)]/90">
              {trace.kindInfo.meaning}
            </p>
            <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--copper)]">
              What It Does in the Argument
            </p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
              {trace.kindInfo.whatItDoes}
            </p>
          </div>

          <div className="border-t border-[var(--line)] pt-3 sm:border-l sm:border-t-0 sm:pl-3.5 sm:pt-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--copper)]">
              How This Output Was Made (Provenance Trace)
            </p>
            <ol className="mt-1.5 space-y-2">
              {trace.steps.map((step) => (
                <li key={step.step} className="text-xs leading-snug">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-[var(--ink)]">
                      {step.step}
                    </span>
                    <span
                      className={`text-[10px] uppercase tracking-[0.08em] ${
                        step.tone === "positive"
                          ? "text-[#8fbf9a]"
                          : step.tone === "warning"
                            ? "text-[#d4a08c]"
                            : "text-[var(--muted)]"
                      }`}
                    >
                      {step.actor}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                    {step.detail}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* Connected Upstream Inputs & Downstream Effects */}
        {trace.upstream.length > 0 || trace.downstream.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 border border-[var(--line)] bg-[var(--bg)]/50 px-3.5 py-2.5 text-xs">
            {trace.upstream.map(({ node: up, edgeKind }) => (
              <button
                key={`up-${up.id}`}
                type="button"
                onClick={() => onOpenNode?.(up.id)}
                className="node-cite-pill is-interactive"
              >
                ← {NODE_KIND_TAXONOMY[up.kind].shortLabel}: {up.title.slice(0, 26)} (
                {EDGE_KIND_TAXONOMY[edgeKind].label})
              </button>
            ))}
            {trace.downstream.map(({ node: down, edgeKind }) => (
              <button
                key={`down-${down.id}`}
                type="button"
                onClick={() => onOpenNode?.(down.id)}
                className="node-cite-pill is-interactive"
              >
                {EDGE_KIND_TAXONOMY[edgeKind].label} →{" "}
                {NODE_KIND_TAXONOMY[down.kind].shortLabel}: {down.title.slice(0, 26)}
              </button>
            ))}
          </div>
        ) : null}

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
                        Empirical Series: {chip.seriesTitle || chip.seriesId || chip.label}
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
                Verified Data & Statutory Spans ({node.provenance.filter((c) => c.spanId).length})
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
                          {chip.label} ↗
                        </a>
                      ) : (
                        <span>{chip.label}</span>
                      )}
                      <p className="mt-0.5 font-mono text-[11px] text-[var(--muted)]">
                        Span ID: {chip.spanId}
                      </p>
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}

          {analysis && analysis.citations.length > 0 ? (
            <div className="mt-6">
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--copper)]">
                Literature & Official Citations
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
                        {citation.title} ↗
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
        </div>
      </div>
    </div>
  );
}
