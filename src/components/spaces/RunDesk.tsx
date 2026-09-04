"use client";

import { useEffect, useRef, useState } from "react";
import { AnalysisModal } from "@/components/studio/AnalysisModal";
import { Composer } from "@/components/studio/Composer";
import { LiveGraph } from "@/components/studio/LiveGraph";
import { Thread } from "@/components/studio/Thread";
import { useWorkspace } from "@/components/app/WorkspaceProvider";

export function RunDesk() {
  const { snapshot, activeId, busy, loadingRun, send } = useWorkspace();
  const [draft, setDraft] = useState("");
  const [modalNodeId, setModalNodeId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const threadTick = snapshot?.items
    .map((item) =>
      item.kind === "narration" || item.kind === "status"
        ? `${item.id}:${item.text.length}`
        : item.id,
    )
    .join("|");

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [threadTick]);

  const modalNode =
    snapshot?.nodes.find((node) => node.id === modalNodeId) ??
    snapshot?.items.find(
      (item): item is Extract<typeof item, { kind: "node" }> =>
        item.kind === "node" && item.node.id === modalNodeId,
    )?.node ??
    null;
  const modalAnalysis = modalNodeId ? snapshot?.analyses[modalNodeId] ?? null : null;
  const workingItem = snapshot?.items.find((item) => item.id === "crew-working");
  const working = workingItem?.kind === "status" ? workingItem.text : null;

  return (
    <main className="run-stage">
      <section className="run-graph-frame">
        <header className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--copper)]">
              Graph
            </p>
            <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">
              {snapshot
                ? `${snapshot.nodes.length} nodes · ${snapshot.edges.length} edges`
                : "No run"}
            </p>
          </div>
          {working ? (
            <p className="max-w-[18rem] text-right text-[11px] uppercase tracking-[0.12em] text-[var(--copper)]">
              {working}
            </p>
          ) : null}
        </header>
        <LiveGraph
          nodes={snapshot?.nodes ?? []}
          edges={snapshot?.edges ?? []}
          selectedId={modalNodeId}
          busy={busy}
          onOpenNode={setModalNodeId}
        />
      </section>

      <section className="chat-frame relative z-10 flex min-h-0 flex-col">
        <header className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--copper)]">
              Run
            </p>
            <h1 className="mt-1 font-[family-name:var(--font-display)] text-xl tracking-tight">
              {snapshot?.run.title ?? "No run selected"}
            </h1>
          </div>
        </header>

        {activeId ? (
          snapshot && snapshot.items.length === 0 && !busy && !loadingRun ? (
            <div className="flex min-h-0 flex-1 flex-col justify-center px-8">
              <h2 className="font-[family-name:var(--font-display)] text-3xl tracking-tight">
                Ask into this run
              </h2>
              <p className="mt-3 max-w-md text-sm leading-relaxed text-[var(--muted)]">
                Agents stream here. Nodes appear on the map as the crew places
                them.
              </p>
            </div>
          ) : (
            <Thread
              items={snapshot?.items ?? []}
              onOpenNode={setModalNodeId}
              listRef={listRef}
            />
          )
        ) : (
          <div className="flex min-h-0 flex-1 flex-col justify-center px-8">
            <h2 className="font-[family-name:var(--font-display)] text-3xl tracking-tight">
              Open a run
            </h2>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-[var(--muted)]">
              New work starts in the sidebar. The chat only writes into the run
              you opened.
            </p>
          </div>
        )}

        <Composer
          value={draft}
          busy={busy}
          disabled={!activeId}
          onChange={setDraft}
          onSubmit={() => {
            const text = draft;
            setDraft("");
            void send(text);
          }}
        />
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
