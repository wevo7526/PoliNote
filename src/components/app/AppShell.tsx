"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PoliMark } from "@/components/mark/PoliMark";
import { SPACES } from "@/lib/spaces";
import { useWorkspace } from "./WorkspaceProvider";

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const {
    projects,
    activeProjectId,
    activeProject,
    runs,
    activeId,
    snapshot,
    healthWarnings,
    creating,
    createError,
    selectProject,
    createProject,
    deleteProject,
    newRun,
    selectRun,
    deleteRun,
  } = useWorkspace();

  const [addingProject, setAddingProject] = useState(false);
  const [newProjectTitle, setNewProjectTitle] = useState("");
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({});
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [dismissedWarnings, setDismissedWarnings] = useState(false);

  const isSandbox = pathname.startsWith("/app/sandbox");
  const isProjectPage = pathname.startsWith("/app/project");
  const isRunSpace = SPACES.some(
    (space) => pathname === space.href || pathname.startsWith(`${space.href}/`),
  );

  // Close mobile drawer automatically on route changes
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname, activeId, activeProjectId]);

  const toggleProjectCollapse = (projectId: string) => {
    setCollapsedProjects((prev) => ({
      ...prev,
      [projectId]: !prev[projectId],
    }));
  };

  const handleCreateProject = async (event: React.FormEvent) => {
    event.preventDefault();
    const title = newProjectTitle.trim() || "New Policy Project";
    setNewProjectTitle("");
    setAddingProject(false);
    const created = await createProject({ title });
    setCollapsedProjects((prev) => ({ ...prev, [created.id]: false }));
    selectProject(created.id, true);
    setMobileMenuOpen(false);
  };

  const handleCopyShareLink = async () => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (activeId) url.searchParams.set("run", activeId);
    url.searchParams.set("readonly", "1");
    try {
      await navigator.clipboard.writeText(url.toString());
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 2000);
    } catch {
      /* ignore clipboard error */
    }
  };

  return (
    <div className="studio flex h-dvh min-h-0 overflow-hidden">
      {/* Mobile Compact Header Bar (visible <= 860px) */}
      <div className="mobile-shell-bar">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            className="mobile-drawer-toggle"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-expanded={mobileMenuOpen}
            aria-label="Toggle projects and runs drawer"
          >
            {mobileMenuOpen ? "✕ Close" : "☰ Projects"}
          </button>
          <Link href="/" className="flex items-center gap-2 text-[var(--ink)]">
            <PoliMark className="h-6 w-6" />
            <span className="font-[family-name:var(--font-display)] text-base leading-none tracking-tight">
              PoliNote
            </span>
          </Link>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="node-action text-[var(--copper)]"
            disabled={creating}
            onClick={() => void newRun(activeProjectId ?? undefined)}
          >
            + Run
          </button>
          <Link
            href="/app/sandbox"
            className={`sandbox-launch-pill ${isSandbox ? "is-active" : ""}`}
          >
            Sandbox
          </Link>
        </div>
      </div>

      {/* Mobile Backdrop */}
      {mobileMenuOpen ? (
        <div
          className="mobile-drawer-backdrop"
          role="presentation"
          onClick={() => setMobileMenuOpen(false)}
        />
      ) : null}

      <aside
        className={`run-sidebar flex h-full min-h-0 flex-col ${
          mobileMenuOpen ? "is-mobile-open" : ""
        }`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3.5">
          <Link href="/" className="flex items-center gap-2.5 text-[var(--ink)]">
            <PoliMark className="h-7 w-7" />
            <div>
              <span className="block font-[family-name:var(--font-display)] text-lg leading-none tracking-tight">
                PoliNote
              </span>
              <span className="mt-0.5 block text-[9px] uppercase tracking-[0.16em] text-[var(--muted)]">
                Econometric Workbench
              </span>
            </div>
          </Link>
          <Link
            href="/app/sandbox"
            className={`sandbox-launch-pill ${isSandbox ? "is-active" : ""}`}
            title="Open the Simulated Perspective Sandbox"
          >
            Sandbox
          </Link>
        </div>

        <div className="border-b border-[var(--line)] px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="new-run-btn flex-1"
              disabled={creating}
              onClick={() => {
                void newRun(activeProjectId ?? undefined);
              }}
            >
              {creating ? "Opening…" : "+ New run"}
            </button>
            <button
              type="button"
              className="project-add-btn"
              onClick={() => setAddingProject((prev) => !prev)}
              title="Create a new project"
            >
              + Project
            </button>
          </div>

          {addingProject ? (
            <form onSubmit={handleCreateProject} className="mt-2 flex flex-col gap-1.5">
              <input
                type="text"
                className="field-input text-xs"
                placeholder="Project name (e.g., TCJA & Investment)…"
                value={newProjectTitle}
                onChange={(event) => setNewProjectTitle(event.target.value)}
                autoFocus
              />
              <div className="flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  className="node-action"
                  onClick={() => setAddingProject(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="node-action text-[var(--copper)]">
                  Create
                </button>
              </div>
            </form>
          ) : null}

          {createError ? (
            <p className="mt-1.5 text-[11px] leading-snug text-[var(--copper)]">
              {createError}
            </p>
          ) : null}
        </div>

        <nav
          className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2.5"
          aria-label="Projects and runs"
        >
          <div className="flex items-center justify-between px-1.5 pb-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
              Projects ({projects.length})
            </p>
            <span
              className="text-[9px] uppercase tracking-[0.12em] text-[var(--copper)]/80"
              title="Projects and runs are localized to your browser and session — no account required"
            >
              Local session
            </span>
          </div>

          <ul className="space-y-2">
            {projects.map((project) => {
              const projectRuns = runs.filter(
                (run) =>
                  run.projectId === project.id ||
                  (!run.projectId && project.id === projects[0]?.id),
              );
              const isSelectedProject = project.id === activeProjectId;
              const isCollapsed = Boolean(collapsedProjects[project.id]);

              return (
                <li
                  key={project.id}
                  className={`project-group ${isSelectedProject ? "is-active" : ""}`}
                >
                  <div className="project-header-row">
                    <button
                      type="button"
                      className="project-toggle-btn"
                      onClick={() => {
                        selectProject(project.id);
                        toggleProjectCollapse(project.id);
                      }}
                      aria-label={isCollapsed ? "Expand project" : "Collapse project"}
                    >
                      <span className="project-caret">
                        {isCollapsed ? "▸" : "▾"}
                      </span>
                    </button>
                    <Link
                      href={`/app/project?project=${project.id}`}
                      onClick={() => selectProject(project.id)}
                      className={`project-title-link min-w-0 flex-1 ${
                        isProjectPage && isSelectedProject ? "is-current" : ""
                      }`}
                    >
                      <span className="block truncate font-medium text-[var(--ink)]">
                        {project.title}
                      </span>
                      <span className="block text-[10px] text-[var(--muted)]">
                        {projectRuns.length} run{projectRuns.length === 1 ? "" : "s"} · Project hub
                      </span>
                    </Link>
                    <button
                      type="button"
                      className="project-quick-run"
                      title={`New run in ${project.title}`}
                      onClick={() => {
                        selectProject(project.id);
                        void newRun(project.id);
                      }}
                    >
                      +
                    </button>
                    {projects.length > 1 ? (
                      <button
                        type="button"
                        className="run-delete"
                        aria-label={`Delete project ${project.title}`}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Delete project “${project.title}” and its ${projectRuns.length} run(s)?`,
                            )
                          ) {
                            void deleteProject(project.id);
                          }
                        }}
                      >
                        ×
                      </button>
                    ) : null}
                  </div>

                  {!isCollapsed ? (
                    <div className="project-runs-tree">
                      {projectRuns.length === 0 ? (
                        <p className="px-2 py-1.5 text-[11px] text-[var(--muted)]">
                          No runs yet. Click + to start one.
                        </p>
                      ) : (
                        <ul className="space-y-1">
                          {projectRuns.map((run) => {
                            const active = run.id === activeId;
                            return (
                              <li
                                key={run.id}
                                className={`run-tree-card ${active ? "is-active" : ""}`}
                              >
                                <div className="run-row">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      selectProject(project.id);
                                      void selectRun(
                                        run.id,
                                        isRunSpace ? pathname : "/app/run",
                                      );
                                    }}
                                    className={`run-item min-w-0 flex-1 text-left ${
                                      active ? "is-active" : ""
                                    }`}
                                  >
                                    <span className="block truncate text-[13px] font-medium text-[var(--ink)]">
                                      {run.title}
                                    </span>
                                    <span className="mt-0.5 block text-[10px] text-[var(--muted)]">
                                      {formatWhen(run.updatedAt)}
                                    </span>
                                  </button>
                                  <button
                                    type="button"
                                    className="run-delete"
                                    aria-label={`Delete ${run.title}`}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      if (
                                        window.confirm(
                                          `Delete “${run.title}”? This clears the run from your project.`,
                                        )
                                      ) {
                                        void deleteRun(run.id);
                                      }
                                    }}
                                  >
                                    ×
                                  </button>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>

      <div className="studio-main relative flex min-h-0 min-w-0 flex-1 flex-col">
        {!dismissedWarnings && healthWarnings.length > 0 ? (
          <div
            role="status"
            aria-label="Platform configuration and health warnings"
            className="flex flex-wrap items-center justify-between gap-2 border-b border-[#d4b483]/35 bg-[#d4b483]/10 px-4 py-2 text-xs"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--copper)]">
                Health & Config Status (/api/health):
              </span>
              {healthWarnings.map((w) => (
                <span
                  key={w.key}
                  className={`px-2 py-0.5 text-[11px] ${
                    w.severity === "critical"
                      ? "border border-[#d46a6a]/50 bg-[#d46a6a]/15 text-[#f0b6b6]"
                      : w.severity === "warning"
                        ? "border border-[#d4b483]/50 bg-[#d4b483]/15 text-[#f3eee4]"
                        : "border border-[var(--line)] bg-[var(--bg)]/60 text-[var(--muted)]"
                  }`}
                >
                  <strong className="font-mono">{w.key}:</strong> {w.message}
                </span>
              ))}
            </div>
            <button
              type="button"
              className="node-action shrink-0"
              onClick={() => setDismissedWarnings(true)}
            >
              Dismiss
            </button>
          </div>
        ) : null}

        {isRunSpace && activeId ? (
          <header className="workspace-topbar">
            <div className="flex min-w-0 items-center gap-2 text-xs">
              {activeProject ? (
                <>
                  <Link
                    href={`/app/project?project=${activeProject.id}`}
                    className="truncate text-[11px] font-medium text-[var(--copper)] hover:underline"
                  >
                    {activeProject.title}
                  </Link>
                  <span className="text-[var(--muted)]">/</span>
                </>
              ) : null}
              <span className="truncate font-medium text-[var(--ink)]">
                {snapshot?.run.title ?? "Active run"}
              </span>
              {snapshot?.invalidatedNodeIds && snapshot.invalidatedNodeIds.length > 0 ? (
                <span className="invalidated-pill">
                  {snapshot.invalidatedNodeIds.length} node(s) need re-check
                </span>
              ) : null}
            </div>

            <nav className="workspace-tabs" aria-label="Run desks">
              {SPACES.map((space) => {
                const spaceActive =
                  pathname === space.href || pathname.startsWith(`${space.href}/`);
                return (
                  <Link
                    key={space.id}
                    href={`${space.href}?run=${activeId}`}
                    className={`workspace-tab ${spaceActive ? "is-active" : ""}`}
                    title={space.blurb}
                  >
                    <span>{space.label}</span>
                    {space.id === "map" && snapshot && snapshot.nodes.length > 0 ? (
                      <span className="workspace-tab-badge">{snapshot.nodes.length}</span>
                    ) : null}
                  </Link>
                );
              })}
              <button
                type="button"
                className="workspace-tab text-[var(--copper)]"
                onClick={() => void handleCopyShareLink()}
                title="Copy shareable read-only run link"
              >
                {shareCopied ? "✓ Link Copied" : "Share Run"}
              </button>
            </nav>
          </header>
        ) : null}

        {children}
      </div>
    </div>
  );
}
