"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnalysisModal } from "@/components/studio/AnalysisModal";
import { Composer } from "@/components/studio/Composer";
import { GraphScrubber } from "@/components/studio/GraphScrubber";
import { LiveGraph } from "@/components/studio/LiveGraph";
import { Thread } from "@/components/studio/Thread";
import { useWorkspace } from "@/components/app/WorkspaceProvider";
import { replayToSeq } from "@/lib/ai/run-log";
import { shortNodeKey } from "@/lib/ui/prose";
import type { DigressionNode } from "@/schemas/digression";

const QUICK_QUESTIONS = [
  "25% ad valorem tariff on imported battery-electric vehicles: US retail prices, domestic assembly jobs, and tariff revenue",
  "By-right transit-oriented upzoning within 0.5 miles of rail stations: housing supply, rents, and municipal fiscal incidence",
  "Carbon border adjustment mechanism on imported steel and aluminum: pass-through, domestic emissions, and retaliation risk",
  "Domestic semiconductor fabrication tax credit (25% ITC): fab investment, skilled labor wages, and downstream chip prices",
];

export function RunDesk() {
  const {
    snapshot,
    activeId,
    activeProject,
    busy,
    loadingRun,
    send,
    setNodeStatus,
  } = useWorkspace();
  const [draft, setDraft] = useState("");
  const [modalNodeId, setModalNodeId] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [scrubSeq, setScrubSeq] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const threadTick = [
    snapshot?.items
      .map((item) =>
        item.kind === "narration" || item.kind === "status"
          ? `${item.id}:${item.text.length}`
          : item.id,
      )
      .join("|"),
    snapshot?.events?.length ?? 0,
  ].join(":");

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [threadTick]);

  useEffect(() => {
    if (busy) setScrubSeq(null);
  }, [busy]);

  const viewSnapshot = useMemo(() => {
    if (!snapshot) return null;
    if (scrubSeq === null) return snapshot;
    return replayToSeq(snapshot, scrubSeq);
  }, [snapshot, scrubSeq]);

  const graphNodes = viewSnapshot?.nodes ?? [];
  const graphEdges = viewSnapshot?.edges ?? [];

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

  const invalidatedIds = snapshot?.invalidatedNodeIds ?? [];
  const invalidatedFields = snapshot?.invalidatedFields ?? [];

  const handleDigress = (node: DigressionNode) => {
    const key = shortNodeKey(node.id);
    void send(
      `Digress deeper from [${key}] (“${node.title}”): test its mechanism, check empirical series or statutory constraints, and place a counterfactual or fork branch.`,
    );
  };

  return (
    <main className="run-stage">
      <section className="run-graph-frame">
        <header className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--copper)]">
              Blueprint Policy Graph
            </p>
            <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">
              {snapshot
                ? `${graphNodes.length} nodes · ${graphEdges.length} edges · ${
                    graphNodes.filter((n) => n.status === "supported").length
                  } supported`
                : "Ready to map policy spine & digressions"}
            </p>
          </div>
          {working ? (
            <p className="max-w-[20rem] text-right text-[11px] uppercase tracking-[0.12em] text-[var(--copper)]">
              {working}
            </p>
          ) : null}
        </header>

        {invalidatedIds.length > 0 ? (
          <div className="invalidation-banner">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#d4a08c]">
                Scope Contract Edited · {invalidatedIds.length} node
                {invalidatedIds.length === 1 ? "" : "s"} invalidated
              </p>
              <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
                Changed: {invalidatedFields.join(", ")}. Affected downstream nodes were marked contested.
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              className="node-action text-[var(--copper)]"
              onClick={() => {
                const keys = invalidatedIds.map(shortNodeKey).join(", ");
                void send(
                  `Re-evaluate the invalidated subgraph (${keys}) under the updated scope contract (${invalidatedFields.join(", ")}). Update mechanisms, evidence spans, and incidence.`,
                );
              }}
            >
              Re-run affected slice →
            </button>
          </div>
        ) : null}

        <LiveGraph
          nodes={graphNodes}
          edges={graphEdges}
          selectedId={modalNodeId}
          busy={busy}
          onOpenNode={setModalNodeId}
          onQuickPrompt={(prompt) => void send(prompt)}
        />

        <GraphScrubber
          events={snapshot?.events ?? []}
          scrubSeq={scrubSeq}
          onChangeSeq={setScrubSeq}
        />
      </section>

      <section className="chat-frame relative z-10 flex min-h-0 flex-col">
        <header className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-3.5">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--copper)]">
              {activeProject ? `${activeProject.title} · Run` : "Crew Intake & Digest"}
            </p>
            <h1 className="mt-1 truncate font-[family-name:var(--font-display)] text-xl tracking-tight">
              {snapshot?.run.title ?? "Ask a policy question to start"}
            </h1>
          </div>
          <Link
            href="/app/sandbox"
            className="node-action shrink-0 text-[var(--copper)]"
          >
            Try Sandbox
          </Link>
        </header>

        {!activeId || (snapshot && snapshot.items.length === 0 && !busy && !loadingRun) ? (
          <div className="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto px-6 py-6">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--copper)]">
              Zero-Friction Start
            </p>
            <h2 className="mt-1.5 font-[family-name:var(--font-display)] text-2xl tracking-tight">
              Type below or pick a policy inquiry
            </h2>
            <p className="mt-2 max-w-md text-xs leading-relaxed text-[var(--muted)]">
              The crew locks a Scope Contract, pulls live FRED series, OpenAlex papers, and statutory text via MCP, and builds the 5-stage policy spine on the left.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              {QUICK_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={busy}
                  onClick={() => void send(q)}
                  className="starter-chip text-left text-xs leading-snug"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <Thread
            items={snapshot?.items ?? []}
            events={snapshot?.events ?? []}
            nodes={snapshot?.nodes ?? []}
            analyses={snapshot?.analyses ?? {}}
            scope={snapshot?.scope ?? null}
            onOpenNode={setModalNodeId}
            listRef={listRef}
          />
        )}

        <Composer
          value={draft}
          busy={busy}
          disabled={false}
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
          allNodes={snapshot?.nodes ?? []}
          edges={snapshot?.edges ?? []}
          events={snapshot?.events ?? []}
          onClose={() => setModalNodeId(null)}
          onOpenNode={setModalNodeId}
          onSetStatus={(nodeId, status) => {
            setStatusBusy(true);
            void setNodeStatus(nodeId, status).finally(() => setStatusBusy(false));
          }}
          onDigress={handleDigress}
          statusBusy={statusBusy}
        />
      ) : null}
    </main>
  );
}
