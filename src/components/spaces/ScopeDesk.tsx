"use client";

import { useEffect, useState } from "react";
import { NeedRun } from "@/components/app/NeedRun";
import { useWorkspace } from "@/components/app/WorkspaceProvider";
import {
  isScopeReady,
  type AllowedMethod,
  type ScopeContract,
} from "@/schemas/scope-contract";

const METHODS: AllowedMethod[] = [
  "literature",
  "time_series",
  "legal_text",
  "macro",
  "incidence",
  "counterfactual",
  "expert_judgment",
];

const FIELDS: Array<{ key: keyof ScopeContract; label: string; rows?: number }> = [
  { key: "objective", label: "Objective", rows: 6 },
  { key: "instrument", label: "Instrument", rows: 6 },
  { key: "target", label: "Target", rows: 5 },
  { key: "identificationStrategy", label: "Identification", rows: 6 },
  { key: "horizon", label: "Horizon", rows: 4 },
  { key: "jurisdiction", label: "Jurisdiction", rows: 4 },
  { key: "baseline", label: "Baseline", rows: 5 },
  { key: "distributionalCut", label: "Distributional cut", rows: 3 },
  { key: "question", label: "Source question", rows: 3 },
];

function emptyScope(runId: string): ScopeContract {
  const ts = new Date().toISOString();
  return {
    id: `${runId}_scope`,
    question: "",
    jurisdiction: "",
    horizon: "",
    objective: "",
    instrument: "",
    target: "",
    identificationStrategy: "",
    distributionalCut: "",
    baseline: "",
    allowedMethods: ["literature", "time_series", "legal_text"],
    forbiddenMoves: [],
    mcpAllowlist: {
      "econ-series": true,
      "policy-docs": true,
      literature: true,
      workspace: true,
      trace: true,
    },
    createdAt: ts,
    updatedAt: ts,
  };
}

export function ScopeDesk() {
  const { snapshot, activeId, saveScope } = useWorkspace();
  const [draft, setDraft] = useState<ScopeContract | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!activeId) {
      setDraft(null);
      return;
    }
    setDraft(snapshot?.scope ?? emptyScope(activeId));
  }, [activeId, snapshot?.scope]);

  if (!activeId || !draft) {
    return (
      <main className="space-page">
        <NeedRun label="Scope" />
      </main>
    );
  }

  const ready = isScopeReady(draft);

  return (
    <main className="space-page">
      <section className="work-frame">
        <header className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--copper)]">
              Scope contract
            </p>
            <h1 className="mt-1 font-[family-name:var(--font-display)] text-xl">
              Protocol for this run
            </h1>
          </div>
          <span className={`text-[11px] uppercase tracking-[0.12em] ${ready ? "text-[#8fbf9a]" : "text-[#d4b483]"}`}>
            {ready ? "ready" : "incomplete"}
          </span>
        </header>

        <form
          className="min-h-0 flex-1 overflow-y-auto px-5 py-5"
          onSubmit={(event) => {
            event.preventDefault();
            setSaving(true);
            void saveScope({
              ...draft,
              updatedAt: new Date().toISOString(),
            }).then((ok) => {
              setSaving(false);
              setSaved(ok);
            });
          }}
        >
          <div className="grid gap-4">
            {FIELDS.map((field) => {
              const value = draft[field.key];
              if (typeof value !== "string") return null;
              return (
                <label key={field.key} className="block">
                  <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">
                    {field.label}
                  </span>
                  <textarea
                    rows={field.rows ?? 1}
                    className="field-input mt-1"
                    value={value}
                    onChange={(event) => {
                      setSaved(false);
                      setDraft({ ...draft, [field.key]: event.target.value });
                    }}
                  />
                </label>
              );
            })}

            <fieldset>
              <legend className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">
                Allowed methods
              </legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {METHODS.map((method) => {
                  const on = draft.allowedMethods.includes(method);
                  return (
                    <button
                      key={method}
                      type="button"
                      className={`method-chip ${on ? "is-on" : ""}`}
                      onClick={() => {
                        setSaved(false);
                        setDraft({
                          ...draft,
                          allowedMethods: on
                            ? draft.allowedMethods.filter((item) => item !== method)
                            : [...draft.allowedMethods, method],
                        });
                      }}
                    >
                      {method}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          </div>

          <div className="mt-6 flex items-center gap-3">
            <button type="submit" className="composer-send" disabled={saving}>
              {saving ? "Saving…" : "Save contract"}
            </button>
            {saved ? (
              <span className="text-[12px] text-[#8fbf9a]">Saved to this run</span>
            ) : null}
          </div>
        </form>
      </section>
    </main>
  );
}
