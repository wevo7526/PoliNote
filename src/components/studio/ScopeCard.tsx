import { isScopeReady } from "@/schemas/scope-contract";
import type { ScopeContract } from "@/schemas/scope-contract";

const ROWS: Array<{ key: keyof ScopeContract; label: string }> = [
  { key: "instrument", label: "Instrument" },
  { key: "target", label: "Target" },
  { key: "identificationStrategy", label: "Identification" },
  { key: "horizon", label: "Horizon" },
  { key: "jurisdiction", label: "Jurisdiction" },
  { key: "baseline", label: "Baseline" },
];

export function ScopeCard({ contract }: { contract: ScopeContract }) {
  const ready = isScopeReady(contract);

  return (
    <section className="scope-card">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--copper)]">
          Scope contract
        </span>
        <span
          className={`text-[10px] uppercase tracking-[0.14em] ${
            ready ? "text-[#8fbf9a]" : "text-[#d4b483]"
          }`}
        >
          {ready ? "ready" : "blocked"}
        </span>
      </div>
      <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-[var(--ink)]/90">
        {contract.objective.trim() || contract.question}
      </p>
      <dl className="mt-4 space-y-3">
        {ROWS.map(({ key, label }) => {
          const value = contract[key];
          if (typeof value !== "string" || !value.trim()) return null;
          return (
            <div key={key}>
              <dt className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">
                {label}
              </dt>
              <dd className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--ink)]">
                {value}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
