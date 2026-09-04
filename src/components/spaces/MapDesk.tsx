"use client";

import { useState } from "react";
import { NeedRun } from "@/components/app/NeedRun";
import { useWorkspace } from "@/components/app/WorkspaceProvider";
import { AnalysisModal } from "@/components/studio/AnalysisModal";
import { LiveGraph } from "@/components/studio/LiveGraph";

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
            {snapshot?.nodes.length ?? 0} nodes · {snapshot?.edges.length ?? 0} edges
          </p>
        </header>

        <div className="relative min-h-0 flex-1">
          <LiveGraph
            nodes={snapshot?.nodes ?? []}
            edges={snapshot?.edges ?? []}
            selectedId={modalNodeId}
            onOpenNode={setModalNodeId}
          />
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
