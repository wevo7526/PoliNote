"use client";

import { useState } from "react";
import { useWorkspace } from "@/components/app/WorkspaceProvider";
import { AnalysisBody } from "@/components/studio/AnalysisBody";
import {
  CounterfactualTrajectoryChart,
  FredSeriesChartCard,
  ImpulseResponseChart,
  type ExtractedSeries,
} from "@/components/studio/ReportCharts";
import { buildRunEconomicModel } from "@/lib/economics/engine";
import {
  SANDBOX_PERSONAS,
  type SandboxPersona,
  type SandboxStreamEvent,
} from "@/lib/ai/sandbox";

type SandboxTurnRecord = {
  id: string;
  prompt: string;
  persona: SandboxPersona | null;
  text: string;
  charts: ExtractedSeries[];
  followUps: string[];
  busy: boolean;
};

const PLAYFUL_PRESETS = [
  {
    personaId: "adam_smith",
    label: "Adam Smith on the Current Macro Regime",
    prompt: "You are Adam Smith, tell us about the current macro regime as him",
  },
  {
    personaId: "keynes",
    label: "Keynes on Interest Rates & Animal Spirits",
    prompt:
      "You are John Maynard Keynes: diagnose today's interest rates, fiscal deficits, and AI capex boom.",
  },
  {
    personaId: "hamilton",
    label: "Hamilton on EV Tariffs & Chip Bounties",
    prompt:
      "You are Alexander Hamilton: defend domestic semiconductor subsidies and EV tariffs using your 1791 Report on Manufactures.",
  },
  {
    personaId: "friedman",
    label: "Friedman on Monetary Lags & Tariff Incidence",
    prompt:
      "You are Milton Friedman: who really pays for a 25% import tariff and how should the Fed read current CPI inflation?",
  },
];

export function SandboxDesk() {
  const { activeProject, send: sendToProjectRun } = useWorkspace();
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>("auto");
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<SandboxTurnRecord[]>([]);
  const [busy, setBusy] = useState(false);

  const runSandboxPrompt = async (promptText: string, personaOverride?: string) => {
    const trimmed = promptText.trim();
    if (!trimmed || busy) return;

    const turnId = `sb_${Date.now()}`;
    const chosenPersonaId = personaOverride ?? selectedPersonaId;
    setBusy(true);
    setInput("");

    setTurns((prev) => [
      ...prev,
      {
        id: turnId,
        prompt: trimmed,
        persona: null,
        text: "",
        charts: [],
        followUps: [],
        busy: true,
      },
    ]);

    try {
      const response = await fetch("/api/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: trimmed,
          personaId: chosenPersonaId,
        }),
      });

      if (!response.body) {
        throw new Error("Sandbox stream was empty");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const line = chunk.split("\n").find((entry) => entry.startsWith("data:"));
          if (!line) continue;
          const payload = line.replace(/^data:\s?/, "").trim();
          if (!payload) continue;
          const ev = JSON.parse(payload) as SandboxStreamEvent;
          setTurns((prev) =>
            prev.map((turn) => {
              if (turn.id !== turnId) return turn;
              if (ev.type === "meta") {
                return {
                  ...turn,
                  persona: ev.persona,
                  charts: ev.charts,
                  followUps: ev.followUps,
                };
              }
              if (ev.type === "delta") {
                return { ...turn, text: turn.text + ev.text };
              }
              if (ev.type === "error") {
                return {
                  ...turn,
                  text: `${turn.text}\n\n${ev.message}`.trim(),
                  busy: false,
                };
              }
              if (ev.type === "done") {
                return { ...turn, busy: false };
              }
              return turn;
            }),
          );
        }
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not complete Sandbox turn.";
      setTurns((prev) =>
        prev.map((t) =>
          t.id === turnId ? { ...t, text: message, busy: false } : t,
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="space-page">
      <section className="work-frame map-frame flex flex-col overflow-hidden">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--copper)]">
              Interactive Political Economy Sandbox
            </p>
            <h1 className="mt-1 font-[family-name:var(--font-display)] text-2xl">
              Thinker Lenses & Live Macro Regime Playground
            </h1>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Ask any question in the voice of Adam Smith, Keynes, Friedman, Hamilton, Ostrom, or Volcker — grounded in live FRED time-series charts.
            </p>
          </div>
          {turns.length > 0 ? (
            <button
              type="button"
              className="node-action"
              onClick={() => setTurns([])}
            >
              Clear Sandbox
            </button>
          ) : null}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {/* Persona Lens Picker */}
          <div className="mb-5">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                Choose a Thinker Lens (or let your prompt pick automatically)
              </p>
              <button
                type="button"
                onClick={() => setSelectedPersonaId("auto")}
                className={`graph-filter-pill ${
                  selectedPersonaId === "auto" ? "is-active" : ""
                }`}
              >
                Auto-detect from prompt
              </button>
            </div>

            <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {SANDBOX_PERSONAS.map((persona) => {
                const active = selectedPersonaId === persona.id;
                return (
                  <div
                    key={persona.id}
                    className={`persona-card ${active ? "is-active" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        className="text-left"
                        onClick={() => setSelectedPersonaId(persona.id)}
                      >
                        <span className="block text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--copper)]">
                          {persona.era} · {persona.school}
                        </span>
                        <span className="mt-1 block font-[family-name:var(--font-display)] text-base text-[var(--ink)]">
                          {persona.name}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="node-action shrink-0 text-[var(--copper)]"
                        disabled={busy}
                        onClick={() => {
                          setSelectedPersonaId(persona.id);
                          void runSandboxPrompt(persona.sampleQuestion, persona.id);
                        }}
                      >
                        Ask →
                      </button>
                    </div>
                    <p className="mt-1.5 text-xs leading-snug text-[var(--muted)]">
                      {persona.tagline}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Empty state playful presets */}
          {turns.length === 0 ? (
            <div className="border border-[var(--line)] bg-[var(--paper)] p-5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--copper)]">
                Try an Interactive Prompt
              </p>
              <div className="mt-3 grid gap-2.5 md:grid-cols-2">
                {PLAYFUL_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setSelectedPersonaId(preset.personaId);
                      void runSandboxPrompt(preset.prompt, preset.personaId);
                    }}
                    className="starter-card text-left"
                  >
                    <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--copper)]">
                      {preset.label}
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-[var(--ink)]/90">
                      “{preset.prompt}”
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {/* Streamed Sandbox Turns */}
          <div className="space-y-6">
            {turns.map((turn) => (
              <article
                key={turn.id}
                className="border border-[var(--line)] bg-[var(--paper)] p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line)] pb-3.5">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--copper)]">
                      {turn.persona
                        ? `${turn.persona.name} · ${turn.persona.era} (${turn.persona.school})`
                        : "Summoning economist lens & live FRED indicators…"}
                    </p>
                    <h2 className="mt-1 font-[family-name:var(--font-display)] text-xl text-[var(--ink)]">
                      “{turn.prompt}”
                    </h2>
                  </div>

                  <button
                    type="button"
                    className="node-action text-[var(--copper)]"
                    onClick={() => {
                      void sendToProjectRun(turn.prompt);
                    }}
                    title="Promote this Sandbox inquiry into a full 5-stage Policy Spine Run in your active Project"
                  >
                    Promote to Project Run ({activeProject?.title ?? "Project"}) →
                  </button>
                </div>

                {/* Live FRED Macro Regime + Counterfactual Time-Series Charts */}
                {turn.charts.length > 0 ? (
                  <div className="mt-4 space-y-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                      Empirical FRED Time-Series & Regime Projections Examined by{" "}
                      {turn.persona?.name ?? "Persona"}
                    </p>
                    <div className="grid gap-3 lg:grid-cols-3">
                      {turn.charts.map((series) => (
                        <FredSeriesChartCard key={series.key} series={series} />
                      ))}
                    </div>
                    {(() => {
                      const sim = buildRunEconomicModel({
                        question: turn.prompt,
                        scope: null,
                        nodes: [],
                        fredSeries: turn.charts,
                      });
                      return (
                        <div className="grid gap-3 lg:grid-cols-2">
                          <CounterfactualTrajectoryChart
                            series={sim.counterfactual}
                            compact
                          />
                          <ImpulseResponseChart
                            series={sim.impulseResponse}
                            compact
                          />
                        </div>
                      );
                    })()}
                  </div>
                ) : null}

                {/* Streamed Persona Analysis */}
                <div className="mt-4">
                  {turn.text ? (
                    <AnalysisBody text={turn.text} />
                  ) : (
                    <p className="text-xs uppercase tracking-[0.14em] text-[var(--copper)]">
                      Reading FRED series and composing response…
                    </p>
                  )}
                </div>

                {/* Follow-up & Debate Chips */}
                {!turn.busy && turn.followUps.length > 0 ? (
                  <div className="mt-4 border-t border-[var(--line)] pt-3.5">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                      Continue the Debate or Switch Lens
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {turn.followUps.map((q) => (
                        <button
                          key={q}
                          type="button"
                          disabled={busy}
                          onClick={() => void runSandboxPrompt(q)}
                          className="starter-chip text-left text-xs"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </div>

        {/* Sandbox Composer */}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void runSandboxPrompt(input);
          }}
          className="composer-shell border-t border-[var(--line)]"
        >
          <input
            type="text"
            className="composer-input py-1"
            placeholder="Ask anything — e.g., “You are Adam Smith, tell us about the current macro regime as him”…"
            value={input}
            disabled={busy}
            onChange={(event) => setInput(event.target.value)}
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="composer-send"
          >
            {busy ? "Thinking…" : "Explore"}
          </button>
        </form>
      </section>
    </main>
  );
}
