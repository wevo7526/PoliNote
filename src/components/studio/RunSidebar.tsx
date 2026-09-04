"use client";

import Link from "next/link";
import { PoliMark } from "@/components/mark/PoliMark";
import type { RunSummary } from "@/lib/platform-types";

type RunSidebarProps = {
  runs: RunSummary[];
  activeId: string | null;
  creating: boolean;
  onNewRun: () => void;
  onSelect: (id: string) => void;
};

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

export function RunSidebar({
  runs,
  activeId,
  creating,
  onNewRun,
  onSelect,
}: RunSidebarProps) {
  return (
    <aside className="run-sidebar flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-4">
        <Link href="/" className="flex items-center gap-2 text-[var(--ink)]">
          <PoliMark className="h-8 w-8" />
          <span className="font-[family-name:var(--font-display)] text-lg tracking-tight">
            PoliNote
          </span>
        </Link>
      </div>

      <div className="border-b border-[var(--line)] px-4 py-3">
        <button
          type="button"
          className="new-run-btn w-full"
          disabled={creating}
          onClick={onNewRun}
        >
          {creating ? "Opening…" : "New run"}
        </button>
        <p className="mt-2 text-[11px] leading-snug text-[var(--muted)]">
          Runs live in your session only. New work starts here, not in the chat.
        </p>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-2" aria-label="Previous runs">
        {runs.length === 0 ? (
          <p className="px-2 py-6 text-sm text-[var(--muted)]">No runs yet.</p>
        ) : (
          <ul className="space-y-1">
            {runs.map((run) => {
              const active = run.id === activeId;
              return (
                <li key={run.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(run.id)}
                    className={`run-item w-full text-left ${active ? "is-active" : ""}`}
                  >
                    <span className="block truncate font-medium text-[var(--ink)]">
                      {run.title}
                    </span>
                    <span className="mt-1 block text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">
                      {run.status} · {formatWhen(run.updatedAt)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </nav>
    </aside>
  );
}
