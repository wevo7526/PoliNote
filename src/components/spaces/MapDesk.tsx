"use client";

import { useState } from "react";
import { NeedRun } from "@/components/app/NeedRun";
import { useWorkspace } from "@/components/app/WorkspaceProvider";
import { AnalysisModal } from "@/components/studio/AnalysisModal";
import { GraphVeil } from "@/components/studio/GraphVeil";

export function MapDesk() {
  const { snapshot, activeId } = useWorkspace();
  const [modalNodeId, setModalNodeId] = useState<string | null>(null);

  if (!activeId) {
    return (
      <main className="space-page">
        <NeedRun label="Map" />
      </main>
    );
  }

  const modalNode = snapshot?.nodes.find((node) => node.id === modalNodeId) ?? null;
  const modalAnalysis = modalNodeId ? snapshot?.analyses[modalNodeId] ?? null : null;

  return (
    <main className="space-page">
      <section className="work-frame relative overflow-hidden">
        <header className="relative z-10 flex items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--copper)]">
              Map
            </p>
            <h1 className="mt-1 font-[family-name:var(--font-display)] text-xl">
              {snapshot?.run.title ?? "Digression"}
            </h1>
          </div>
          <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">
            {snapshot?.nodes.length ?? 0} nodes
          </p>
        </header>

        <div className="relative min-h-0 flex-1">
          <GraphVeil
            nodes={snapshot?.nodes ?? []}
            edges={snapshot?.edges ?? []}
            selectedId={modalNodeId}
          />
          {(snapshot?.nodes.length ?? 0) === 0 ? (
            <div className="relative z-10 flex h-full items-center px-8">
              <p className="max-w-md text-sm text-[var(--muted)]">
                No graph yet. Ask a question in Run and the crew will lay nodes
                here.
              </p>
            </div>
          ) : (
            <ul className="relative z-10 grid max-h-full gap-2 overflow-y-auto p-4 sm:grid-cols-2">
              {snapshot?.nodes.map((node) => (
                <li key={node.id}>
                  <button
                    type="button"
                    className="node-card w-full text-left"
                    onClick={() => setModalNodeId(node.id)}
                  >
                    <span className={`kind-tag kind-${node.kind}`}>{node.kind}</span>
                    <h2 className="mt-2 font-[family-name:var(--font-display)] text-[1.05rem] leading-snug">
                      {node.title}
                    </h2>
                    <p className="mt-2 text-[11px] uppercase tracking-[0.12em] text-[var(--copper)]">
                      Open analysis
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {modalNode ? (
        <AnalysisModal
          node={modalNode}
          analysis={modalAnalysis}
          onClose={() => setModalNodeId(null)}
        />
      ) : null}
    </main>
  );
}
