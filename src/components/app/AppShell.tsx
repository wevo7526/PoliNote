"use client";

import type { ReactNode } from "react";
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
    runs,
    activeId,
    snapshot,
    creating,
    newRun,
    selectRun,
    deleteRun,
  } = useWorkspace();

  return (
    <div className="studio flex h-dvh min-h-0 overflow-hidden">
      <aside className="run-sidebar flex h-full min-h-0 flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-4">
          <Link href="/" className="flex items-center gap-2 text-[var(--ink)]">
            <PoliMark className="h-8 w-8" />
            <span className="font-[family-name:var(--font-display)] text-lg tracking-tight">
              PoliNote
            </span>
          </Link>
        </div>

        <nav className="border-b border-[var(--line)] px-2 py-3" aria-label="Spaces">
          <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
            Spaces
          </p>
          <ul className="space-y-1">
            {SPACES.map((space) => {
              const active = pathname === space.href || pathname.startsWith(`${space.href}/`);
              const href = activeId ? `${space.href}?run=${activeId}` : space.href;
              return (
                <li key={space.id}>
                  <Link
                    href={href}
                    className={`space-link ${active ? "is-active" : ""}`}
                  >
                    {space.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="border-b border-[var(--line)] px-4 py-3">
          <button
            type="button"
            className="new-run-btn w-full"
            disabled={creating}
            onClick={() => {
              void newRun();
            }}
          >
            {creating ? "Opening…" : "New run"}
          </button>
          <p className="mt-2 text-[11px] leading-snug text-[var(--muted)]">
            {snapshot
              ? `Active · ${snapshot.run.title}`
              : "Pick or create a run. Isolation is per session."}
          </p>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-2" aria-label="Previous runs">
          <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
            Runs
          </p>
          {runs.length === 0 ? (
            <p className="px-2 py-4 text-sm text-[var(--muted)]">No runs yet.</p>
          ) : (
            <ul className="space-y-1">
              {runs.map((run) => {
                const active = run.id === activeId;
                return (
                  <li key={run.id} className="run-row">
                    <button
                      type="button"
                      onClick={() => {
                        void selectRun(run.id);
                      }}
                      className={`run-item min-w-0 flex-1 text-left ${active ? "is-active" : ""}`}
                    >
                      <span className="block truncate font-medium text-[var(--ink)]">
                        {run.title}
                      </span>
                      <span className="mt-1 block text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">
                        {run.status} · {formatWhen(run.updatedAt)}
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
                            `Delete “${run.title}”? This clears the run from your slate.`,
                          )
                        ) {
                          void deleteRun(run.id);
                        }
                      }}
                    >
                      Delete
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>
      </aside>

      <div className="studio-main relative flex min-h-0 min-w-0 flex-1 flex-col">
        {children}
      </div>
    </div>
  );
}
