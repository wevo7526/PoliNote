"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RunSnapshot, RunSummary } from "@/lib/platform-types";
import { AnalysisModal } from "./AnalysisModal";
import { Composer } from "./Composer";
import { GraphVeil } from "./GraphVeil";
import { RunSidebar } from "./RunSidebar";
import { Thread } from "./Thread";

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export function Studio() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [loadingRun, setLoadingRun] = useState(false);
  const [modalNodeId, setModalNodeId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const applySnapshot = useCallback((next: RunSnapshot) => {
    setSnapshot(next);
    setActiveId(next.run.id);
    setRuns((prev) => {
      const rest = prev.filter((run) => run.id !== next.run.id);
      return [next.run, ...rest];
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await fetch("/api/runs");
      if (!response.ok || cancelled) return;
      const data = await readJson<{ runs: RunSummary[] }>(response);
      if (!cancelled) setRuns(data.runs);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [snapshot?.items.length]);

  const selectRun = useCallback(async (id: string) => {
    setLoadingRun(true);
    setModalNodeId(null);
    try {
      const response = await fetch(`/api/runs/${id}`);
      if (!response.ok) return;
      const data = await readJson<RunSnapshot>(response);
      setSnapshot(data);
      setActiveId(data.run.id);
    } finally {
      setLoadingRun(false);
    }
  }, []);

  const newRun = useCallback(async () => {
    setCreating(true);
    try {
      const response = await fetch("/api/runs", { method: "POST" });
      if (!response.ok) return;
      const data = await readJson<{ run: RunSummary }>(response);
      setRuns((prev) => [data.run, ...prev.filter((run) => run.id !== data.run.id)]);
      setActiveId(data.run.id);
      setSnapshot({
        run: data.run,
        items: [],
        nodes: [],
        edges: [],
        scope: null,
        analyses: {},
        events: [],
        draft: null,
      });
      setModalNodeId(null);
      setDraft("");
    } finally {
      setCreating(false);
    }
  }, []);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || !activeId || busy) return;
    setDraft("");
    setBusy(true);
    try {
      const response = await fetch(`/api/runs/${activeId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await readJson<RunSnapshot>(response);
      if (data.run) applySnapshot(data);
    } finally {
      setBusy(false);
    }
  }, [activeId, applySnapshot, busy, draft]);

  const modalNode =
    snapshot?.nodes.find((node) => node.id === modalNodeId) ??
    snapshot?.items.find(
      (item): item is Extract<typeof item, { kind: "node" }> =>
        item.kind === "node" && item.node.id === modalNodeId,
    )?.node ??
    null;
  const modalAnalysis = modalNodeId ? snapshot?.analyses[modalNodeId] ?? null : null;

  return (
    <div className="studio flex h-dvh min-h-0 overflow-hidden">
      <RunSidebar
        runs={runs}
        activeId={activeId}
        creating={creating}
        onNewRun={() => {
          void newRun();
        }}
        onSelect={(id) => {
          void selectRun(id);
        }}
      />

      <main className="studio-main relative flex min-h-0 min-w-0 flex-1 items-center justify-center p-4 md:p-6">
        <GraphVeil
          nodes={snapshot?.nodes ?? []}
          edges={snapshot?.edges ?? []}
          selectedId={modalNodeId}
        />

        <section className="chat-frame relative z-10 flex h-full max-h-[860px] w-full max-w-[44rem] flex-col">
          <header className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--copper)]">
                Run
              </p>
              <h1 className="mt-1 font-[family-name:var(--font-display)] text-xl tracking-tight">
                {snapshot?.run.title ?? "No run selected"}
              </h1>
            </div>
            <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">
              {snapshot
                ? `${snapshot.nodes.length} nodes · ${snapshot.edges.length} edges`
                : "sidebar → new run"}
            </p>
          </header>

          {activeId ? (
            snapshot && snapshot.items.length === 0 && !busy && !loadingRun ? (
              <div className="flex min-h-0 flex-1 flex-col justify-center px-8">
                <h2 className="font-[family-name:var(--font-display)] text-3xl tracking-tight">
                  Ask into this run
                </h2>
                <p className="mt-3 max-w-md text-sm leading-relaxed text-[var(--muted)]">
                  The chat builds the digression graph. Click a node for the
                  written analysis. Open another run from the sidebar — do not
                  start one here.
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
                Previous digressions stay in the left rail, isolated to this
                browser session. Create a new run there, then talk.
              </p>
            </div>
          )}

          <Composer
            value={draft}
            busy={busy}
            disabled={!activeId}
            onChange={setDraft}
            onSubmit={() => {
              void send();
            }}
          />
        </section>
      </main>

      {modalNode ? (
        <AnalysisModal
          node={modalNode}
          analysis={modalAnalysis}
          onClose={() => setModalNodeId(null)}
        />
      ) : null}
    </div>
  );
}
