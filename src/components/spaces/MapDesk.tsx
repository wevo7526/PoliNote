"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { NeedRun } from "@/components/app/NeedRun";
import { useWorkspace } from "@/components/app/WorkspaceProvider";
import { AnalysisModal } from "@/components/studio/AnalysisModal";
import { GraphScrubber } from "@/components/studio/GraphScrubber";
import { LiveGraph } from "@/components/studio/LiveGraph";
import { NodeActions } from "@/components/studio/NodeActions";
import { replayToSeq } from "@/lib/ai/run-log";
import { shortNodeKey } from "@/lib/ui/prose";
import type { DigressionNode, UserNodeStatus } from "@/schemas/digression";

export function MapDesk() {
  const router = useRouter();
  const { snapshot, activeId, setNodeStatus, send } = useWorkspace();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [scrubSeq, setScrubSeq] = useState<number | null>(null);

  const viewSnapshot = useMemo(() => {
    if (!snapshot) return null;
    if (scrubSeq === null) return snapshot;
    return replayToSeq(snapshot, scrubSeq);
  }, [snapshot, scrubSeq]);

  if (!activeId) {
    return (
      <main className="space-page">
        <NeedRun label="Map" />
      </main>
    );
  }

  const nodes = viewSnapshot?.nodes ?? [];
  const edges = viewSnapshot?.edges ?? [];
  const selected = nodes.find((node) => node.id === selectedId) ?? null;
  const modalAnalysis = selectedId ? viewSnapshot?.analyses[selectedId] ?? null : null;

  const onSetStatus = (nodeId: string, status: UserNodeStatus) => {
    setStatusBusy(true);
    void setNodeStatus(nodeId, status).finally(() => setStatusBusy(false));
  };

  const handleDigress = (node: DigressionNode) => {
    const key = shortNodeKey(node.id);
    router.push(`/app/run?run=${activeId}`);
    void send(
      `Digress deeper from [${key}] (“${node.title}”): test its mechanism, check empirical series or statutory constraints, and place a counterfactual or fork branch.`,
    );
  };

  return (
    <main className="space-page">
      <section className="work-frame map-frame relative overflow-hidden">
        <header className="relative z-10 flex items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-3.5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--copper)]">
              Knowledge Graph Map
            </p>
            <h1 className="mt-1 font-[family-name:var(--font-display)] text-xl">
              {snapshot?.run.title ?? "Digression"}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">
              {nodes.length} nodes · {edges.length} edges
            </p>
          </div>
        </header>

        <div className="relative flex min-h-0 flex-1 flex-col">
          <LiveGraph
            nodes={nodes}
            edges={edges}
            selectedId={selectedId}
            onOpenNode={(id) => {
              if (selectedId === id) {
                setModalOpen(true);
              } else {
                setSelectedId(id);
                setModalOpen(false);
              }
            }}
            onQuickPrompt={(prompt) => {
              router.push(`/app/run?run=${activeId}`);
              void send(prompt);
            }}
          />

          <GraphScrubber
            events={snapshot?.events ?? []}
            scrubSeq={scrubSeq}
            onChangeSeq={setScrubSeq}
          />
        </div>

        {selected ? (
          <div className="map-selection">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--copper)]">
                {selected.kind} · {selected.status} · [{shortNodeKey(selected.id)}]
              </p>
              <p className="mt-0.5 truncate text-sm font-medium text-[var(--ink)]">
                {selected.title}
              </p>
              <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
                {selected.body}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <NodeActions
                node={selected}
                disabled={statusBusy}
                onSetStatus={onSetStatus}
              />
              <button
                type="button"
                className="node-action text-[var(--copper)]"
                onClick={() => handleDigress(selected)}
              >
                + Digress from node
              </button>
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
          allNodes={nodes}
          onClose={() => setModalOpen(false)}
          onOpenNode={(id) => setSelectedId(id)}
          onSetStatus={onSetStatus}
          onDigress={handleDigress}
          statusBusy={statusBusy}
        />
      ) : null}
    </main>
  );
}
