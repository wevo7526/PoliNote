"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnalysisModal } from "@/components/studio/AnalysisModal";
import { Composer } from "@/components/studio/Composer";
import { GraphScrubber } from "@/components/studio/GraphScrubber";
import { LiveGraph } from "@/components/studio/LiveGraph";
import { RunTimelineStrip } from "@/components/studio/ReportCharts";
import { Thread } from "@/components/studio/Thread";
import { useWorkspace } from "@/components/app/WorkspaceProvider";
import { replayToSeq } from "@/lib/ai/run-log";
import { shortNodeKey } from "@/lib/ui/prose";
import type { DigressionNode } from "@/schemas/digression";

const QUICK_QUESTIONS = [
  "Did the 2017 Tax Cuts and Jobs Act (TCJA) increase US real private nonresidential fixed investment?",
  "2018 Section 232 & 301 tariffs: pass-through to US import prices, CPI durable goods, and manufacturing employment",
  "By-right transit-oriented upzoning within 0.5 miles of rail stations: multifamily housing starts, rents, and municipal fiscal incidence",
  "Federal minimum wage increase to $15/hour: teen/hospitality employment elasticity, real earnings, and restaurant price pass-through",
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
  const [mobilePane, setMobilePane] = useState<"chat" | "graph">("chat");
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
      `Digress deeper from [${key}] (“${node.title}”): test its mechanism, check live series or statutory constraints, and place a counterfactual or specification fork.`,
    );
  };

  return (
    <main className={`run-stage mobile-pane-${mobilePane}`}>
      {/* Mobile-only pane switcher between Analysis/Chat and Argument Map */}
      <div className="mobile-pane-switcher">
        <button
          type="button"
          onClick={() => setMobilePane("chat")}
          className={`mobile-pane-btn ${mobilePane === "chat" ? "is-active" : ""}`}
        >
          Analysis & Crew ({snapshot?.items.length ?? 0})
        </button>
        <button
          type="button"
          onClick={() => setMobilePane("graph")}
          className={`mobile-pane-btn ${mobilePane === "graph" ? "is-active" : ""}`}
        >
          Argument Map ({graphNodes.length} nodes)
        </button>
      </div>

      <section className="run-graph-frame">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line)] px-4 py-2.5 sm:px-5 sm:py-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--copper)]">
              Blueprint Policy Graph & Pre-Registration Map
            </p>
            <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">
              {snapshot
                ? `${graphNodes.length} nodes · ${graphEdges.length} edges · ${
                    graphNodes.filter((n) => n.status === "supported").length
                  } supported`
                : "Ready to lock scope & estimate on live data"}
            </p>
          </div>
          {working ? (
            <p className="max-w-[20rem] text-right text-[11px] uppercase tracking-[0.12em] text-[var(--copper)]">
              {working}
            </p>
          ) : null}
        </header>

        <RunTimelineStrip
          events={snapshot?.events ?? []}
          nodes={graphNodes}
          busy={busy}
        />

        {invalidatedIds.length > 0 ? (
          <div className="invalidation-banner">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#d4a08c]">
                Scope Contract Edited · {invalidatedIds.length} node
                {invalidatedIds.length === 1 ? "" : "s"} invalidated (Fork Created)
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
                  `Re-evaluate the invalidated subgraph (${keys}) as a pre-registered fork under the updated scope contract (${invalidatedFields.join(", ")}). Re-run live estimation and compare against baseline.`,
                );
              }}
            >
              Re-run forked slice →
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
        <header className="flex items-start justify-between gap-3 border-b border-[var(--line)] px-4 py-3 sm:px-5 sm:py-3.5">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--copper)]">
              {activeProject ? `${activeProject.title} · Econometric Run` : "Crew Intake & Digest"}
            </p>
            <h1 className="mt-1 truncate font-[family-name:var(--font-display)] text-lg tracking-tight sm:text-xl">
              {snapshot?.run.title ?? "Ask a policy question to start"}
            </h1>
          </div>
          <Link
            href="/app/sandbox"
            className="node-action shrink-0 text-[var(--copper)]"
          >
            Sandbox
          </Link>
        </header>

        {!activeId || (snapshot && snapshot.items.length === 0 && !busy && !loadingRun) ? (
          <div className="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--copper)]">
              Live Econometric & Policy Digression Engine
            </p>
            <h2 className="mt-1.5 font-[family-name:var(--font-display)] text-xl tracking-tight sm:text-2xl">
              Type below or pick a benchmark policy inquiry
            </h2>
            <p className="mt-2 max-w-md text-xs leading-relaxed text-[var(--muted)]">
              The 9-role crew pre-registers a Scope Contract, pulls live series from FRED/ALFRED, BEA, BLS & World Bank, runs Event Study and Jordà Local Projections with HAC CIs, audits every number in prose, and builds the argument map.
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
            estimates={snapshot?.estimates}
            robustness={snapshot?.robustness}
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
