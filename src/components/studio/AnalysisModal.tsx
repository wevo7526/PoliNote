"use client";

import { useEffect, useId, useRef } from "react";
import { AnalysisBody } from "@/components/studio/AnalysisBody";
import type { NodeAnalysis } from "@/schemas/analysis";
import type { DigressionNode } from "@/schemas/digression";

type AnalysisModalProps = {
  node: DigressionNode;
  analysis: NodeAnalysis | null;
  onClose: () => void;
};

export function AnalysisModal({ node, analysis, onClose }: AnalysisModalProps) {
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
            <p className={`kind-tag kind-${node.kind}`}>{node.kind}</p>
            <h2
              id={titleId}
              className="mt-2 font-[family-name:var(--font-display)] text-2xl leading-tight"
            >
              {analysis?.title ?? node.title}
            </h2>
            <p className="mt-2 text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">
              {node.status} · {node.confidence}
              {node.agent ? ` · ${node.agent}` : ""}
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="modal-body">
          <AnalysisBody text={analysis?.body ?? node.body} />

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
