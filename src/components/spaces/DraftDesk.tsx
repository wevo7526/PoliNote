"use client";

import { useState } from "react";
import { NeedRun } from "@/components/app/NeedRun";
import { useWorkspace } from "@/components/app/WorkspaceProvider";
import { AnalysisBody } from "@/components/studio/AnalysisBody";
import { AnalysisModal } from "@/components/studio/AnalysisModal";
import {
  FredSeriesChartCard,
  IncidenceTradeoffMatrix,
  SpineCoverageChart,
  VerifiedBibliographyTable,
  collectBibliography,
  extractFredSeries,
} from "@/components/studio/ReportCharts";
import { shortNodeKey } from "@/lib/ui/prose";

function buildBrief(title: string, question: string, nodeLines: string[]): string {
  return [
    `## Executive Summary`,
    "",
    question,
    "",
    "## Core Policy Findings",
    "",
    ...nodeLines,
  ].join("\n");
}

export function DraftDesk() {
  const { snapshot, activeId, activeProject, setNodeStatus } = useWorkspace();
  const [modalNodeId, setModalNodeId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!activeId || !snapshot) {
    return (
      <main className="space-page">
        <NeedRun label="Report" />
      </main>
    );
  }

  const claims = snapshot.nodes.filter(
    (node) => node.kind === "claim" || node.kind === "incidence" || node.kind === "mechanism",
  );
  const rest = snapshot.nodes.filter(
    (node) => node.kind !== "claim" && node.kind !== "incidence" && node.kind !== "mechanism",
  );
  const brief =
    snapshot.draft?.brief ??
    buildBrief(
      snapshot.run.title,
      snapshot.scope?.question ?? "No question locked yet.",
      (claims.length > 0 ? claims : snapshot.nodes).map(
        (node) =>
          `- **${node.title}** [${shortNodeKey(node.id)}] — ${node.body}`,
      ),
    );
  const appendix =
    snapshot.draft?.appendix ??
    rest
      .map((node) => {
        const analysis = snapshot.analyses[node.id];
        return `## ${node.kind.toUpperCase()}: ${node.title}\n\n${
          analysis?.body ?? node.body
        } [${shortNodeKey(node.id)}]`;
      })
      .join("\n\n");

  const fredSeries = extractFredSeries(snapshot.nodes);
  const bib = collectBibliography(snapshot.nodes, snapshot.analyses);
  const modalNode = snapshot.nodes.find((n) => n.id === modalNodeId) ?? null;
  const modalAnalysis = modalNodeId ? snapshot.analyses[modalNodeId] ?? null : null;

  const handleCopyMarkdown = async () => {
    const refLines = bib.map(
      (b) => `[${b.index}] (${b.kind} · ${b.source}) ${b.label}${b.url ? ` — ${b.url}` : ""}`,
    );
    const md = [
      `# ${snapshot.run.title}`,
      activeProject ? `*Project: ${activeProject.title}*` : "",
      "",
      brief,
      "",
      "## Technical Appendix",
      "",
      appendix,
      "",
      "## Verified References & MCP Spans",
      "",
      ...refLines,
    ]
      .filter(Boolean)
      .join("\n");
    await navigator.clipboard.writeText(md);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <main className="space-page">
      <section className="work-frame overflow-y-auto">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--copper)]">
              Report & Empirical Artifacts
            </p>
            <h1 className="mt-1 font-[family-name:var(--font-display)] text-2xl">
              {snapshot.run.title}
            </h1>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {snapshot.nodes.filter((n) => n.status === "supported").length} supported nodes ·{" "}
              {fredSeries.length} FRED series chart{fredSeries.length === 1 ? "" : "s"} ·{" "}
              {bib.length} verified source{bib.length === 1 ? "" : "s"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="node-action text-[var(--copper)]"
              onClick={() => void handleCopyMarkdown()}
            >
              {copied ? "✓ Copied Markdown" : "Copy Markdown"}
            </button>
            <button
              type="button"
              className="node-action"
              onClick={() => window.print()}
            >
              Print / Save PDF
            </button>
          </div>
        </header>

        <div className="p-5">
          {/* Top Visual Charts Row */}
          {snapshot.nodes.length > 0 ? (
            <div className="mb-5 grid gap-4 lg:grid-cols-2">
              <SpineCoverageChart nodes={snapshot.nodes} />
              {fredSeries.map((series) => (
                <FredSeriesChartCard key={series.key} series={series} />
              ))}
            </div>
          ) : null}

          {/* Two-Column Grounded Brief & Technical Appendix */}
          <div className="grid gap-4 lg:grid-cols-2">
            <article className="draft-col">
              <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--copper)]">
                Executive Policy Brief
              </h2>
              <AnalysisBody
                text={brief}
                nodes={snapshot.nodes}
                onOpenNode={setModalNodeId}
              />
            </article>
            <article className="draft-col">
              <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--copper)]">
                Technical & Methodology Appendix
              </h2>
              <AnalysisBody
                text={
                  appendix ||
                  "Appendix fills as mechanisms, constraints, and forks appear."
                }
                nodes={snapshot.nodes}
                onOpenNode={setModalNodeId}
              />
            </article>
          </div>

          <IncidenceTradeoffMatrix
            nodes={snapshot.nodes}
            onOpenNode={setModalNodeId}
          />

          <VerifiedBibliographyTable
            nodes={snapshot.nodes}
            analyses={snapshot.analyses}
          />
        </div>
      </section>

      {modalNode ? (
        <AnalysisModal
          node={modalNode}
          analysis={modalAnalysis}
          allNodes={snapshot.nodes}
          onClose={() => setModalNodeId(null)}
          onOpenNode={setModalNodeId}
          onSetStatus={(nodeId, status) => {
            void setNodeStatus(nodeId, status);
          }}
        />
      ) : null}
    </main>
  );
}
