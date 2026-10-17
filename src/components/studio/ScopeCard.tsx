"use client";

import { useState } from "react";
import Link from "next/link";
import { isScopeReady } from "@/schemas/scope-contract";
import type { ScopeContract } from "@/schemas/scope-contract";

const CORE_PILLS: Array<{ key: keyof ScopeContract; label: string }> = [
  { key: "instrument", label: "Instrument" },
  { key: "target", label: "Target" },
  { key: "identificationStrategy", label: "Identification" },
  { key: "horizon", label: "Horizon" },
];

const EXTRA_ROWS: Array<{ key: keyof ScopeContract; label: string }> = [
  { key: "jurisdiction", label: "Jurisdiction" },
  { key: "baseline", label: "Baseline" },
  { key: "distributionalCut", label: "Distributional cut" },
];

function firstSentence(text: string, maxLen = 135): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const dot = clean.indexOf(". ");
  const slice = dot > 18 && dot < maxLen ? clean.slice(0, dot + 1) : clean;
  return slice.length > maxLen ? `${slice.slice(0, maxLen).trim()}…` : slice;
}

export function ScopeCard({ contract }: { contract: ScopeContract }) {
  const [expanded, setExpanded] = useState(false);
  const ready = isScopeReady(contract);
  const runId = contract.id.replace(/_scope$/, "");

  return (
    <section className="scope-card">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--copper)]">
            Scope contract
          </span>
          <span
            className={`px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] ${
              ready
                ? "bg-[#8fbf9a]/15 text-[#8fbf9a]"
                : "bg-[#d4b483]/15 text-[#d4b483]"
            }`}
          >
            {ready ? "ready" : "blocked"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] hover:text-[var(--ink)]"
            onClick={() => setExpanded((prev) => !prev)}
          >
            {expanded ? "Compact view" : "Expand protocol"}
          </button>
          {runId ? (
            <Link
              href={`/app/scope?run=${runId}`}
              className="text-[10px] uppercase tracking-[0.12em] text-[var(--copper)] hover:underline"
            >
              Edit →
            </Link>
          ) : null}
        </div>
      </div>

      <p className="mt-2.5 text-[13px] leading-relaxed text-[var(--ink)]/92">
        {expanded
          ? contract.objective.trim() || contract.question
          : firstSentence(contract.objective.trim() || contract.question, 190)}
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {CORE_PILLS.map(({ key, label }) => {
          const value = contract[key];
          if (typeof value !== "string" || !value.trim()) return null;
          return (
            <div
              key={key}
              className="border border-[var(--line)] bg-[var(--bg)]/55 px-2.5 py-2"
            >
              <dt className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--copper)]">
                {label}
              </dt>
              <dd className="mt-1 text-[12px] leading-snug text-[var(--ink)]/90">
                {expanded ? value : firstSentence(value, 115)}
              </dd>
            </div>
          );
        })}
      </div>

      {expanded ? (
        <dl className="mt-3 space-y-2.5 border-t border-[var(--line)] pt-3">
          {EXTRA_ROWS.map(({ key, label }) => {
            const value = contract[key];
            if (typeof value !== "string" || !value.trim()) return null;
            return (
              <div key={key}>
                <dt className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">
                  {label}
                </dt>
                <dd className="mt-1 text-[12px] leading-relaxed text-[var(--ink)]">
                  {value}
                </dd>
              </div>
            );
          })}
        </dl>
      ) : null}
    </section>
  );
}
