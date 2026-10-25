"use client";

import { useState } from "react";
import { NeedRun } from "@/components/app/NeedRun";
import { useWorkspace } from "@/components/app/WorkspaceProvider";
import { extractFredSeries } from "@/components/studio/ReportCharts";
import { buildRunEconomicModel } from "@/lib/economics/engine";
import { downloadCsvBundle } from "@/lib/reports/reproducibility";

export function SourcesDesk() {
  const { snapshot, activeId, send, busy } = useWorkspace();
  const [vintageMode, setVintageMode] = useState<"latest_revised" | "realtime_as_of">(
    "latest_revised",
  );
  const [swapSeriesInput, setSwapSeriesInput] = useState("");

  if (!activeId) {
    return (
      <main className="space-page">
        <NeedRun label="Sources & Data" />
      </main>
    );
  }

  const fredSeries = extractFredSeries(snapshot?.nodes ?? []);
  const econModel = buildRunEconomicModel({
    question: snapshot?.scope?.question ?? snapshot?.run.title ?? "",
    scope: snapshot?.scope ?? null,
    nodes: snapshot?.nodes ?? [],
    fredSeries,
    storedEstimates: snapshot?.estimates,
    storedRobustness: snapshot?.robustness,
    preRegistrationLock: snapshot?.preRegistrationLock,
  });

  const spans = (snapshot?.nodes ?? []).flatMap((node) =>
    node.provenance
      .filter((chip) => chip.spanId)
      .map((chip) => ({
        ...chip,
        nodeTitle: node.title,
        nodeId: node.id,
        status: node.status,
      })),
  );
  const citations = Object.values(snapshot?.analyses ?? {}).flatMap((analysis) =>
    analysis.citations.map((citation) => ({
      ...citation,
      nodeId: analysis.nodeId,
      analysisTitle: analysis.title,
    })),
  );

  const handleSwapSeries = (event: React.FormEvent) => {
    event.preventDefault();
    const cleaned = swapSeriesInput.trim().toUpperCase();
    if (!cleaned || busy) return;
    setSwapSeriesInput("");
    void send(
      `Fork the data specification: swap primary outcome series to ${cleaned} (${vintageMode === "realtime_as_of" ? "real-time ALFRED vintage as-of policy date" : "latest revised FRED release"}) and re-run econometric estimation.`,
    );
  };

  return (
    <main className="space-page">
      <section className="work-frame overflow-y-auto">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--line)] px-4 py-3.5 sm:px-5 sm:py-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--copper)]">
              Data Provenance, ALFRED Vintages & Literature Locker
            </p>
            <h1 className="mt-1 font-[family-name:var(--font-display)] text-xl sm:text-2xl">
              Live Series Provenance, SHA-256 Snapshots & Series Picker
            </h1>
            <p className="mt-1 max-w-2xl text-xs text-[var(--muted)]">
              Every series carries full source metadata, seasonal adjustment, transform, observation window, vintage date, and raw payload SHA-256 hash. Toggle between Latest Revised (FRED) and Real-Time As-Of Policy Date (ALFRED) or swap series to spawn a fork.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center border border-[var(--line)] bg-[var(--paper)] p-0.5">
              <button
                type="button"
                onClick={() => setVintageMode("latest_revised")}
                className={`px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] ${
                  vintageMode === "latest_revised"
                    ? "bg-[var(--copper)] text-[var(--bg)]"
                    : "text-[var(--muted)]"
                }`}
              >
                Latest Revised (FRED)
              </button>
              <button
                type="button"
                onClick={() => setVintageMode("realtime_as_of")}
                className={`px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] ${
                  vintageMode === "realtime_as_of"
                    ? "bg-[var(--copper)] text-[var(--bg)]"
                    : "text-[var(--muted)]"
                }`}
              >
                Real-Time Vintage (ALFRED)
              </button>
            </div>
            {fredSeries.length > 0 && econModel.headlineEstimate ? (
              <button
                type="button"
                className="composer-send"
                onClick={() =>
                  downloadCsvBundle({
                    title: snapshot?.run.title ?? "polinote-run",
                    seriesList: fredSeries,
                    econModel,
                  })
                }
              >
                Download CSV Bundle
              </button>
            ) : null}
          </div>
        </header>

        {/* Interactive Series Swapper (Creates a Pre-Registered Fork) */}
        <form
          onSubmit={handleSwapSeries}
          className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] bg-[var(--paper)] px-4 py-3 sm:px-5"
        >
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--copper)]">
            Swap / Add Live Series (Spawns Fork):
          </span>
          <input
            type="text"
            className="field-input max-w-xs flex-1 text-xs"
            placeholder="Enter FRED/BLS/WDI ID (e.g., PNFI, GPDIC1, CPIAUCSL, PAYEMS)…"
            value={swapSeriesInput}
            onChange={(e) => setSwapSeriesInput(e.target.value)}
          />
          <button
            type="submit"
            disabled={busy || !swapSeriesInput.trim()}
            className="node-action text-[var(--copper)]"
          >
            {busy ? "Running Fork…" : "Swap Series & Re-Estimate →"}
          </button>
        </form>

        <div className="space-y-5 p-4 sm:p-5">
          {/* Live Series Provenance Table */}
          {fredSeries.length > 0 ? (
            <section>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--copper)]">
                Attached Live Statistical Series ({fredSeries.length})
              </p>
              <div className="overflow-x-auto border border-[var(--line)]">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-[var(--line)] bg-[var(--paper)] text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">
                      <th className="px-3 py-2.5">Series ID & Title</th>
                      <th className="px-3 py-2.5">Units & Transform</th>
                      <th className="px-3 py-2.5">Observation Window (N)</th>
                      <th className="px-3 py-2.5">Vintage Mode</th>
                      <th className="px-3 py-2.5">Snapshot SHA-256</th>
                      <th className="px-3 py-2.5">Source Link</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--line)]">
                    {fredSeries.map((s) => {
                      const first = s.points[0];
                      const last = s.points[s.points.length - 1];
                      return (
                        <tr key={s.key} className="bg-[var(--bg)]/40">
                          <td className="px-3 py-2.5">
                            <span className="font-mono font-semibold text-[var(--copper)]">
                              {s.seriesId}
                            </span>
                            <span className="block text-[11px] text-[var(--ink)]">
                              {s.title}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-[11px] text-[var(--muted)]">
                            {s.units || "Reported Units"}
                            <span className="block font-mono text-[10px]">
                              {s.provenance?.transform ?? "lin — Levels"}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 font-mono text-[11px] text-[var(--ink)]">
                            {first?.date} → {last?.date} (N={s.points.length})
                          </td>
                          <td className="px-3 py-2.5 font-mono text-[10px] text-[#8fbf9a]">
                            {vintageMode === "realtime_as_of"
                              ? "ALFRED Real-Time"
                              : `FRED (${s.vintage ?? "latest"})`}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-[10px] text-[var(--muted)]">
                            {s.resultHash ? s.resultHash.slice(0, 16) : s.spanId ?? "—"}
                          </td>
                          <td className="px-3 py-2.5">
                            {s.url ? (
                              <a
                                href={s.url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[var(--copper)] hover:underline"
                              >
                                Provider ↗
                              </a>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <div className="grid gap-3">
            {spans.length === 0 && citations.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">
                No live spans attached yet. Run a policy question to pull live series and OpenAlex literature.
              </p>
            ) : null}

            {spans.map((span, index) => (
              <article key={`${span.spanId}-${index}`} className="source-card">
                <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--copper)]">
                  Live MCP Span · {span.source} · {span.nodeTitle} · [{span.status}]
                </p>
                <h2 className="mt-1 font-[family-name:var(--font-display)] text-base sm:text-lg">
                  {span.url ? (
                    <a
                      href={span.url}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-[var(--copper)]"
                    >
                      {span.label} ↗
                    </a>
                  ) : (
                    span.label
                  )}
                </h2>
                <p className="mt-1.5 font-mono text-[11px] text-[var(--muted)]">
                  Span ID: {span.spanId}
                  {span.vintage ? ` · Vintage: ${span.vintage}` : ""}
                  {span.resultHash ? ` · SHA-256: ${span.resultHash.slice(0, 16)}` : ""}
                </p>
              </article>
            ))}

            {citations.map((citation, index) => (
              <article key={`${citation.url ?? citation.title}-${index}`} className="source-card">
                <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--copper)]">
                  Literature / Official Citation · {citation.analysisTitle}
                </p>
                <h2 className="mt-1 font-[family-name:var(--font-display)] text-base sm:text-lg">
                  {citation.url ? (
                    <a
                      href={citation.url}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-[var(--copper)]"
                    >
                      {citation.title} ↗
                    </a>
                  ) : (
                    citation.title
                  )}
                </h2>
                {citation.note ? (
                  <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
                    {citation.note}
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
