"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useWorkspace } from "@/components/app/WorkspaceProvider";
import { AnalysisBody } from "@/components/studio/AnalysisBody";
import {
  FredSeriesChartCard,
  IncidenceTradeoffMatrix,
  SpineCoverageChart,
  VerifiedBibliographyTable,
  collectBibliography,
  extractFredSeries,
} from "@/components/studio/ReportCharts";
import type { ProjectSummary, RunSnapshot, RunSummary } from "@/lib/platform-types";
import type { NodeAnalysis } from "@/schemas/analysis";

type ProjectPayload = {
  project: ProjectSummary;
  runs: RunSummary[];
  snapshots: RunSnapshot[];
};

export function ProjectDesk() {
  const searchParams = useSearchParams();
  const projectParam = searchParams.get("project");
  const {
    projects,
    activeProjectId,
    activeProject,
    updateProject,
    newRun,
    selectRun,
  } = useWorkspace();

  const targetId = projectParam ?? activeProjectId ?? projects[0]?.id ?? null;

  const [data, setData] = useState<ProjectPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [contextMemo, setContextMemo] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!targetId) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const response = await fetch(`/api/projects/${targetId}`);
      if (!response.ok || cancelled) {
        if (!cancelled) setLoading(false);
        return;
      }
      const payload = (await response.json()) as ProjectPayload;
      if (!cancelled) {
        setData(payload);
        setTitle(payload.project.title);
        setDescription(payload.project.description);
        setContextMemo(payload.project.contextMemo);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [targetId]);

  const project = data?.project ?? activeProject;
  const snapshots = data?.snapshots ?? [];
  const allNodes = snapshots.flatMap((s) => s.nodes);
  const allAnalyses: Record<string, NodeAnalysis> = {};
  for (const snap of snapshots) {
    Object.assign(allAnalyses, snap.analyses);
  }
  const fredSeries = extractFredSeries(allNodes);
  const bib = collectBibliography(allNodes, allAnalyses);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!project) return;
    setSaving(true);
    const updated = await updateProject(project.id, {
      title,
      description,
      contextMemo,
    });
    setSaving(false);
    if (updated) {
      setSaved(true);
      setData((prev) => (prev ? { ...prev, project: updated } : prev));
    }
  };

  const masterBrief = snapshots
    .filter((s) => s.nodes.length > 0 || s.draft)
    .map((s) => {
      const body =
        s.draft?.brief ||
        s.nodes
          .slice(0, 4)
          .map((n) => `- **${n.title}**: ${n.body}`)
          .join("\n");
      return `## Run: ${s.run.title}\n\n${body}`;
    })
    .join("\n\n");

  const handleCopyMasterReport = async () => {
    if (!project) return;
    const refs = bib.map(
      (b) => `[${b.index}] (${b.kind} · ${b.source}) ${b.label}${b.url ? ` — ${b.url}` : ""}`,
    );
    const text = [
      `# Project Master Report: ${project.title}`,
      project.description,
      "",
      masterBrief || "No completed run briefs in this project yet.",
      "",
      "## Consolidated Bibliography & MCP Spans",
      ...refs,
    ].join("\n");
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  if (!project) {
    return (
      <main className="space-page">
        <section className="work-frame p-6">
          <p className="text-sm text-[var(--muted)]">
            {loading ? "Loading project workspace…" : "Select or create a project in the sidebar."}
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="space-page">
      <section className="work-frame overflow-y-auto">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--copper)]">
              Project Hub · Shared Context & Master Artifacts
            </p>
            <h1 className="mt-1 font-[family-name:var(--font-display)] text-2xl">
              {project.title}
            </h1>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {snapshots.length} run{snapshots.length === 1 ? "" : "s"} ·{" "}
              {allNodes.length} total graph nodes ·{" "}
              {allNodes.filter((n) => n.status === "supported").length} supported ·{" "}
              {fredSeries.length} FRED chart{fredSeries.length === 1 ? "" : "s"} ·{" "}
              {bib.length} verified source{bib.length === 1 ? "" : "s"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="composer-send"
              onClick={() => void newRun(project.id)}
            >
              + New Run in Project
            </button>
            <button
              type="button"
              className="node-action text-[var(--copper)]"
              onClick={() => void handleCopyMasterReport()}
            >
              {copied ? "✓ Copied Master Report" : "Export Master Report"}
            </button>
            <button
              type="button"
              className="node-action"
              onClick={() => window.print()}
            >
              Print / PDF
            </button>
          </div>
        </header>

        <div className="space-y-6 p-5">
          {/* Shared Project Context & Instructions */}
          <form
            onSubmit={handleSave}
            className="grid gap-4 border border-[var(--line)] bg-[var(--paper)] p-4 lg:grid-cols-3"
          >
            <div>
              <label className="block">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--copper)]">
                  Project Title
                </span>
                <input
                  type="text"
                  className="field-input mt-1 text-sm"
                  value={title}
                  onChange={(e) => {
                    setSaved(false);
                    setTitle(e.target.value);
                  }}
                />
              </label>
              <label className="mt-3 block">
                <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">
                  Scope & Focus Description
                </span>
                <textarea
                  rows={2}
                  className="field-input mt-1 text-xs"
                  value={description}
                  onChange={(e) => {
                    setSaved(false);
                    setDescription(e.target.value);
                  }}
                />
              </label>
            </div>

            <div className="lg:col-span-2">
              <label className="block">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--copper)]">
                  Shared Project Instructions & Standing Memory (Injected into Every Run)
                </span>
                <textarea
                  rows={4}
                  placeholder="Standing instructions, preferred baselines, jurisdiction constraints, or empirical benchmarks shared across all runs in this project…"
                  className="field-input mt-1 text-xs"
                  value={contextMemo}
                  onChange={(e) => {
                    setSaved(false);
                    setContextMemo(e.target.value);
                  }}
                />
              </label>
              <div className="mt-2.5 flex items-center justify-between">
                <span className="text-[11px] text-[var(--muted)]">
                  {saved
                    ? "✓ Project instructions saved and active for new runs."
                    : "Crew turns in this project automatically inherit this context."}
                </span>
                <button
                  type="submit"
                  disabled={saving}
                  className="node-action text-[var(--copper)]"
                >
                  {saving ? "Saving…" : "Save Project Context"}
                </button>
              </div>
            </div>
          </form>

          {/* Runs in this Project */}
          <section>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--copper)]">
              Associated Runs ({snapshots.length})
            </p>
            {snapshots.length === 0 ? (
              <p className="mt-2 text-xs text-[var(--muted)]">
                No runs in this project yet. Click “+ New Run in Project” above to start.
              </p>
            ) : (
              <div className="mt-2.5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {snapshots.map((snap) => (
                  <div
                    key={snap.run.id}
                    className="border border-[var(--line)] bg-[var(--paper)] p-3.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--copper)]">
                        {snap.run.status}
                      </span>
                      <span className="font-mono text-[10px] text-[var(--muted)]">
                        {snap.nodes.length} nodes ·{" "}
                        {snap.nodes.filter((n) => n.status === "supported").length} sup
                      </span>
                    </div>
                    <h3 className="mt-1.5 font-[family-name:var(--font-display)] text-base leading-snug text-[var(--ink)]">
                      {snap.run.title}
                    </h3>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        className="node-action text-[var(--copper)]"
                        onClick={() => void selectRun(snap.run.id, "/app/run")}
                      >
                        Run
                      </button>
                      <Link
                        href={`/app/map?run=${snap.run.id}`}
                        className="node-action"
                      >
                        Map ({snap.nodes.length})
                      </Link>
                      <Link
                        href={`/app/draft?run=${snap.run.id}`}
                        className="node-action"
                      >
                        Report
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Aggregated Project Charts & Graphs */}
          {allNodes.length > 0 ? (
            <section>
              <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--copper)]">
                Project-Wide Empirical Charts & Spine Coverage
              </p>
              <div className="grid gap-4 lg:grid-cols-2">
                <SpineCoverageChart nodes={allNodes} />
                {fredSeries.map((series) => (
                  <FredSeriesChartCard key={series.key} series={series} />
                ))}
              </div>
            </section>
          ) : null}

          {/* Compiled Master Brief Across Runs */}
          {masterBrief ? (
            <section className="draft-col">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--copper)]">
                Compiled Project Master Brief
              </p>
              <AnalysisBody text={masterBrief} nodes={allNodes} />
            </section>
          ) : null}

          <IncidenceTradeoffMatrix nodes={allNodes} />

          <VerifiedBibliographyTable nodes={allNodes} analyses={allAnalyses} />
        </div>
      </section>
    </main>
  );
}
