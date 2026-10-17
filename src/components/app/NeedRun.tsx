"use client";

import Link from "next/link";
import { useWorkspace } from "./WorkspaceProvider";

export function NeedRun({ label }: { label: string }) {
  const { runs, activeProjectId, creating, newRun, selectRun } = useWorkspace();
  const latestRun = runs[0];

  return (
    <div className="work-frame flex h-full flex-col justify-center px-8 py-10">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--copper)]">
        {label} Desk
      </p>
      <h2 className="mt-1.5 font-[family-name:var(--font-display)] text-3xl tracking-tight">
        Start or pick a run in your project
      </h2>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-[var(--muted)]">
        {label} is bound to a run inside a project. Start a new run right here or open your most recent run.
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          className="composer-send"
          disabled={creating}
          onClick={() => void newRun(activeProjectId ?? undefined)}
        >
          {creating ? "Opening…" : "+ New run in project"}
        </button>
        {latestRun ? (
          <button
            type="button"
            className="node-action text-[var(--copper)]"
            onClick={() => void selectRun(latestRun.id)}
          >
            Open “{latestRun.title}” →
          </button>
        ) : null}
        <Link href="/app/sandbox" className="node-action">
          Open Sandbox
        </Link>
      </div>
    </div>
  );
}
