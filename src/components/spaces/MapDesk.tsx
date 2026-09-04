"use client";

import { useState } from "react";
import { NeedRun } from "@/components/app/NeedRun";
import { useWorkspace } from "@/components/app/WorkspaceProvider";
import { AnalysisModal } from "@/components/studio/AnalysisModal";
import { LiveGraph } from "@/components/studio/LiveGraph";
import { NodeActions } from "@/components/studio/NodeActions";
import type { UserNodeStatus } from "@/schemas/digression";

export function MapDesk() {
  const { snapshot, activeId, setNodeStatus } = useWorkspace();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);

  if (!activeId) {
    return (
      <main className="space-page">
        <NeedRun label="Map" />
      </main>
    );
  }

  const selected = snapshot?.nodes.find((node) => node.id === selectedId) ?? null;
  const modalAnalysis = selectedId ? snapshot?.analyses[selectedId] ?? null : null;

  const onSetStatus = (nodeId: string, status: UserNodeStatus) => {
    setStatusBusy(true);
    void setNodeStatus(nodeId, status).finally(() => setStatusBusy(false));
  };

  return (
    <main className="space-page">
      <section className="work-frame map-frame relative overflow-hidden">
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
            selectedId={selectedId}
            onOpenNode={(id) => {
              setSelectedId(id);
              setModalOpen(false);
            }}
          />
        </div>

        {selected ? (
          <div className="map-selection">
            <div>
              <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--copper)]">
                {selected.kind} · {selected.status}
              </p>
              <p className="mt-1 text-sm">{selected.title}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <NodeActions
                node={selected}
                disabled={statusBusy}
                onSetStatus={onSetStatus}
              />
              <button
                type="button"
                className="node-action"
                onClick={() => setModalOpen(true)}
              >
                Open analysis
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {modalOpen && selected ? (
        <AnalysisModal
          node={selected}
          analysis={modalAnalysis}
          onClose={() => setModalOpen(false)}
          onSetStatus={onSetStatus}
          statusBusy={statusBusy}
        />
      ) : null}
    </main>
  );
}
