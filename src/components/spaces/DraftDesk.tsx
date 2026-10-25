"use client";

import { useMemo, useState } from "react";
import { NeedRun } from "@/components/app/NeedRun";
import { useWorkspace } from "@/components/app/WorkspaceProvider";
import { AnalysisBody } from "@/components/studio/AnalysisBody";
import { AnalysisModal } from "@/components/studio/AnalysisModal";
import {
  CounterfactualTrajectoryChart,
  DistributionalIncidenceBarChart,
  EconometricResultsPanel,
  EconomicScorecardBanner,
  FredSeriesChartCard,
  ImpulseResponseChart,
  IncidenceTradeoffMatrix,
  RunTimelineStrip,
  SpineCoverageChart,
  VerifiedBibliographyTable,
  collectBibliography,
  extractFredSeries,
} from "@/components/studio/ReportCharts";
import { buildRunEconomicModel } from "@/lib/economics/engine";
import {
  buildClientFallbackReport,
  downloadPdfReport,
  downloadWordReport,
} from "@/lib/reports/export-artifacts";
import {
  downloadCsvBundle,
  downloadJupyterNotebook,
} from "@/lib/reports/reproducibility";
import type { CompiledPolicyReport } from "@/lib/reports/report-types";
import {
  NODE_KIND_TAXONOMY,
  NODE_STATUS_TAXONOMY,
} from "@/lib/ui/node-taxonomy";
import { shortNodeKey } from "@/lib/ui/prose";

function buildBrief(question: string, nodeLines: string[]): string {
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
  const [compiled, setCompiled] = useState<CompiledPolicyReport | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [exportingWord, setExportingWord] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [copied, setCopied] = useState(false);

  const fredSeries = useMemo(
    () => extractFredSeries(snapshot?.nodes ?? []),
    [snapshot?.nodes],
  );
  const bib = useMemo(
    () =>
      collectBibliography(snapshot?.nodes ?? [], snapshot?.analyses ?? {}),
    [snapshot?.nodes, snapshot?.analyses],
  );

  const econModel = useMemo(
    () =>
      buildRunEconomicModel({
        question: snapshot?.scope?.question ?? snapshot?.run.title ?? "",
        scope: snapshot?.scope ?? null,
        nodes: snapshot?.nodes ?? [],
        fredSeries,
        storedEstimates: snapshot?.estimates,
        storedRobustness: snapshot?.robustness,
        preRegistrationLock: snapshot?.preRegistrationLock,
      }),
    [
      snapshot?.scope,
      snapshot?.run.title,
      snapshot?.nodes,
      snapshot?.estimates,
      snapshot?.robustness,
      snapshot?.preRegistrationLock,
      fredSeries,
    ],
  );

  if (!activeId || !snapshot) {
    return (
      <main className="space-page">
        <NeedRun label="Report" />
      </main>
    );
  }

  const claims = snapshot.nodes.filter(
    (node) =>
      node.kind === "claim" ||
      node.kind === "incidence" ||
      node.kind === "mechanism",
  );
  const rest = snapshot.nodes.filter(
    (node) =>
      node.kind !== "claim" &&
      node.kind !== "incidence" &&
      node.kind !== "mechanism",
  );
  const brief =
    compiled?.executiveSummary
      ? `## Executive Summary\n\n${compiled.executiveSummary}\n\n${compiled.spineNarrative}`
      : (snapshot.draft?.brief ??
        buildBrief(
          snapshot.scope?.question ?? "No question locked yet.",
          (claims.length > 0 ? claims : snapshot.nodes).map(
            (node) =>
              `- **${node.title}** [${shortNodeKey(node.id)}] — ${node.body}`,
          ),
        ));

  const appendix =
    compiled?.methodologyAndTrace
      ? `${compiled.methodologyAndTrace}\n\n## Counterfactuals & Key Risks\n\n${compiled.risksAndCounterfactuals}`
      : (snapshot.draft?.appendix ??
        rest
          .map((node) => {
            const analysis = snapshot.analyses[node.id];
            return `## ${NODE_KIND_TAXONOMY[node.kind].label}: ${node.title}\n\n${
              analysis?.body ?? node.body
            } [${shortNodeKey(node.id)}]`;
          })
          .join("\n\n"));

  const currentReport: CompiledPolicyReport =
    compiled ??
    buildClientFallbackReport({
      title: snapshot.run.title,
      projectTitle: activeProject?.title ?? "Policy Research Studio",
      question: snapshot.scope?.question ?? snapshot.run.title,
      scope: snapshot.scope,
      nodes: snapshot.nodes,
      analyses: snapshot.analyses,
      fredSeries,
      bibliography: bib,
      briefText: brief,
      appendixText: appendix,
    });

  const handleCompileAiReport = async () => {
    setCompiling(true);
    try {
      const response = await fetch("/api/reports/compile", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ runId: snapshot.run.id }),
      });
      if (response.ok) {
        const data = (await response.json()) as { report?: CompiledPolicyReport };
        if (data.report) setCompiled(data.report);
      }
    } finally {
      setCompiling(false);
    }
  };

  const ensureCompiledReport = async (): Promise<CompiledPolicyReport> => {
    if (compiled) return compiled;
    try {
      const response = await fetch("/api/reports/compile", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ runId: snapshot.run.id }),
      });
      if (response.ok) {
        const data = (await response.json()) as { report?: CompiledPolicyReport };
        if (data.report) {
          setCompiled(data.report);
          return data.report;
        }
      }
    } catch {
      /* fall back to client report */
    }
    return currentReport;
  };

  const handleDownloadWord = async () => {
    setExportingWord(true);
    try {
      const reportObj = await ensureCompiledReport();
      await downloadWordReport({
        report: reportObj,
        nodes: snapshot.nodes,
        edges: snapshot.edges,
        analyses: snapshot.analyses,
        scope: snapshot.scope,
        fredSeries,
        bibliography: bib,
      });
    } finally {
      setExportingWord(false);
    }
  };

  const handleDownloadPdf = async () => {
    setExportingPdf(true);
    try {
      const reportObj = await ensureCompiledReport();
      await downloadPdfReport({
        report: reportObj,
        nodes: snapshot.nodes,
        edges: snapshot.edges,
        analyses: snapshot.analyses,
        scope: snapshot.scope,
        fredSeries,
        bibliography: bib,
      });
    } finally {
      setExportingPdf(false);
    }
  };

  const handleCopyMarkdown = async () => {
    const refLines = bib.map(
      (b) =>
        `[${b.index}] (${b.kind} · ${b.source}) ${b.label}${b.url ? ` — ${b.url}` : ""}`,
    );
    const md = [
      `# ${snapshot.run.title}`,
      activeProject ? `*Project: ${activeProject.title}*` : "",
      "",
      brief,
      "",
      "## Technical & Methodology Appendix",
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

  const modalNode = snapshot.nodes.find((n) => n.id === modalNodeId) ?? null;
  const modalAnalysis = modalNodeId ? snapshot.analyses[modalNodeId] ?? null : null;

  return (
    <main className="space-page">
      <section className="work-frame overflow-y-auto">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--copper)]">
              AI Policy Report & Document Artifact
            </p>
            <h1 className="mt-1 font-[family-name:var(--font-display)] text-2xl">
              {snapshot.run.title}
            </h1>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {snapshot.nodes.filter((n) => n.status === "supported").length} verified findings ·{" "}
              {fredSeries.length + 3} embedded economic charts ·{" "}
              {bib.length} cited source{bib.length === 1 ? "" : "s"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={compiling}
              className="node-action border-[var(--copper)]/60 bg-[var(--copper)]/15 text-[var(--copper)]"
              onClick={() => void handleCompileAiReport()}
            >
              {compiling ? "Compiling with AI…" : "Compile AI Report"}
            </button>
            <button
              type="button"
              disabled={exportingWord}
              className="composer-send"
              onClick={() => void handleDownloadWord()}
            >
              {exportingWord ? "Building .docx…" : "Download Word (.docx)"}
            </button>
            <button
              type="button"
              disabled={exportingPdf}
              className="composer-send"
              onClick={() => void handleDownloadPdf()}
            >
              {exportingPdf ? "Building .pdf…" : "Download PDF (.pdf)"}
            </button>
            <button
              type="button"
              disabled={!econModel.headlineEstimate || fredSeries.length === 0}
              className="node-action text-[var(--copper)]"
              onClick={() =>
                downloadCsvBundle({
                  title: snapshot.run.title,
                  seriesList: fredSeries,
                  econModel,
                })
              }
            >
              Download CSV Data
            </button>
            <button
              type="button"
              disabled={!econModel.headlineEstimate || fredSeries.length === 0}
              className="node-action text-[var(--copper)]"
              onClick={() =>
                downloadJupyterNotebook({
                  runId: snapshot.run.id,
                  title: snapshot.run.title,
                  scope: snapshot.scope,
                  seriesList: fredSeries,
                  econModel,
                  nodes: snapshot.nodes,
                  bibliography: bib,
                })
              }
            >
              Jupyter Notebook (.ipynb)
            </button>
            <button
              type="button"
              className="node-action"
              onClick={() => void handleCopyMarkdown()}
            >
              {copied ? "✓ Copied" : "Copy Markdown"}
            </button>
          </div>
        </header>

        <div className="space-y-6 p-4 sm:p-5">
          {/* 7-Stage Pipeline Timeline */}
          <RunTimelineStrip
            events={snapshot.events}
            nodes={snapshot.nodes}
            hasEstimates={Boolean(econModel.headlineEstimate)}
          />

          {/* Quantitative Economic Scorecard */}
          {snapshot.nodes.length > 0 ? (
            <EconomicScorecardBanner scorecard={econModel.scorecard} />
          ) : null}

          {/* Econometric Coefficient Table, Diagnostics & Interactive Specification Forks */}
          <EconometricResultsPanel
            econModel={econModel}
            fredSeries={fredSeries}
          />

          {/* 1. Figures, Time-Series Projections & Empirical Charts */}
          {snapshot.nodes.length > 0 ? (
            <section>
              <div className="mb-2.5 flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--copper)]">
                  1. Counterfactual Projections, Jordà Local Projections & Live Series Charts
                </p>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                {econModel.counterfactual ? (
                  <CounterfactualTrajectoryChart series={econModel.counterfactual} />
                ) : null}
                {econModel.impulseResponse ? (
                  <ImpulseResponseChart series={econModel.impulseResponse} />
                ) : null}
                <DistributionalIncidenceBarChart
                  items={econModel.incidenceDistribution}
                  robustness={econModel.robustness}
                />
                <SpineCoverageChart nodes={snapshot.nodes} />
                {fredSeries.map((series) => (
                  <FredSeriesChartCard key={series.key} series={series} />
                ))}
              </div>
            </section>
          ) : null}

          {/* 2. Executive Policy Brief & Methodology Appendix */}
          <div className="grid gap-4 lg:grid-cols-2">
            <article className="draft-col">
              <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--copper)]">
                2. Executive Policy Brief & Findings
              </h2>
              <AnalysisBody
                text={brief}
                nodes={snapshot.nodes}
                onOpenNode={setModalNodeId}
              />
            </article>
            <article className="draft-col">
              <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--copper)]">
                3. How Output Was Made — Methodology & Risk Appendix
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

          {/* 3. Clear Node-by-Node Trace Table: What Each Node Is & What It Does */}
          {snapshot.nodes.length > 0 ? (
            <section className="border-t border-[var(--line)] pt-5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--copper)]">
                4. Argument Node Guide & Provenance Trace
              </p>
              <h3 className="mt-0.5 font-[family-name:var(--font-display)] text-lg text-[var(--ink)]">
                What Every Node Means, What Role It Plays, and How It Was Verified
              </h3>
              <div className="mt-3 overflow-x-auto border border-[var(--line)]">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-[var(--line)] bg-[var(--paper)] text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">
                      <th className="px-3 py-2.5">Stage & Node Type</th>
                      <th className="px-3 py-2.5">What This Type Does</th>
                      <th className="px-3 py-2.5">Finding Title & Summary</th>
                      <th className="px-3 py-2.5">Verification Standing</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--line)]">
                    {snapshot.nodes.map((node) => {
                      const kindInfo = NODE_KIND_TAXONOMY[node.kind];
                      const statusInfo = NODE_STATUS_TAXONOMY[node.status];
                      return (
                        <tr
                          key={node.id}
                          className="cursor-pointer bg-[var(--bg)]/40 transition hover:bg-[var(--paper-strong)]"
                          onClick={() => setModalNodeId(node.id)}
                        >
                          <td className="px-3 py-2.5 align-top">
                            <span
                              className="block text-[10px] font-semibold uppercase tracking-[0.12em]"
                              style={{ color: kindInfo.color }}
                            >
                              {kindInfo.label}
                            </span>
                            <span className="mt-0.5 block text-[10px] text-[var(--muted)]">
                              {kindInfo.stage}
                            </span>
                          </td>
                          <td className="max-w-xs px-3 py-2.5 align-top text-[11px] leading-snug text-[var(--muted)]">
                            {kindInfo.whatItDoes}
                          </td>
                          <td className="px-3 py-2.5 align-top">
                            <p className="font-medium text-[var(--ink)]">
                              {node.title}
                            </p>
                            <p className="mt-0.5 text-[11px] leading-snug text-[var(--muted)]">
                              {node.body}
                            </p>
                          </td>
                          <td className="px-3 py-2.5 align-top">
                            <span
                              className="inline-block px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.1em]"
                              style={{
                                backgroundColor: statusInfo.bgColor,
                                color: statusInfo.color,
                              }}
                            >
                              {statusInfo.shortLabel}
                            </span>
                            <span className="mt-1 block text-[10px] text-[var(--muted)]">
                              {node.evidenceSpanIds.length > 0
                                ? `${node.evidenceSpanIds.length} empirical source(s)`
                                : "Click to inspect"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <IncidenceTradeoffMatrix
            nodes={snapshot.nodes}
            analyses={snapshot.analyses}
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
          edges={snapshot.edges}
          events={snapshot.events}
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
