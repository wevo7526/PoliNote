"use client";

import { useState } from "react";
import { useWorkspace } from "@/components/app/WorkspaceProvider";
import { AnalysisBody } from "@/components/studio/AnalysisBody";
import {
  FredSeriesChartCard,
  type ExtractedSeries,
} from "@/components/studio/ReportCharts";
import type { EconometricEstimate } from "@/lib/economics/schemas";
import type { ExtractedLiteratureEstimate } from "@/lib/mcp/openalex";
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
  estimates: EconometricEstimate[];
  literature: ExtractedLiteratureEstimate[];
  dataStatusMessage: string;
  followUps: string[];
  busy: boolean;
};

const PLAYFUL_PRESETS = [
  {
    personaId: "adam_smith",
    label: "Adam Smith · Tariff Pass-Through & Division of Labor",
    prompt:
      "You are Adam Smith: evaluate the price pass-through and employment effects of a 25% import tariff on electric vehicles.",
  },
  {
    personaId: "keynes",
    label: "Keynes · TCJA Corporate Tax Cut & Business Investment",
    prompt:
      "You are John Maynard Keynes: evaluate how the 2017 Tax Cuts and Jobs Act affected real private nonresidential fixed investment.",
  },
  {
    personaId: "hamilton",
    label: "Hamilton · Semiconductor Subsidies vs. Tariffs",
    prompt:
      "You are Alexander Hamilton: compare domestic semiconductor investment subsidies against import duties using your 1791 Report on Manufactures.",
  },
  {
    personaId: "friedman",
    label: "Friedman · Monetary Shocks & Inflation Lags",
    prompt:
      "You are Milton Friedman: evaluate monetary policy rate shocks and CPI inflation transmission lags.",
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
        estimates: [],
        literature: [],
        dataStatusMessage: "",
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
                  estimates: ev.estimates,
                  literature: ev.literature,
                  dataStatusMessage: ev.dataStatusMessage,
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
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--line)] px-4 py-3.5 sm:px-5 sm:py-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--copper)]">
                Persona Debate Sandbox
              </span>
              <span className="border border-[var(--copper)]/40 bg-[var(--copper)]/10 px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-[var(--copper)]">
                Simulated Perspective · Audited Numbers Only
              </span>
            </div>
            <h1 className="mt-1 font-[family-name:var(--font-display)] text-xl sm:text-2xl">
              Historical Economist Lenses on Live Estimates & Literature
            </h1>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Personas debate strictly over live fetched series, computed econometric estimates, and OpenAlex literature. They cannot introduce unverified numbers, and no generic fallback charts are injected.
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

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {/* Persona Lens Picker */}
          <div className="mb-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                Choose a Simulated Perspective Lens
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
                          {persona.perspectiveBanner}
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
                        Debate →
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

          {turns.length === 0 ? (
            <div className="border border-[var(--line)] bg-[var(--paper)] p-4 sm:p-5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--copper)]">
                Launch a Simulated Perspective Debate
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
                className="border border-[var(--line)] bg-[var(--paper)] p-4 sm:p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line)] pb-3.5">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="border border-[var(--copper)]/50 bg-[var(--copper)]/15 px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-[var(--copper)]">
                        {turn.persona?.perspectiveBanner ?? "Simulated Perspective"}
                      </span>
                      <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">
                        {turn.persona
                          ? `${turn.persona.name} (${turn.persona.era})`
                          : "Querying live data & literature…"}
                      </span>
                    </div>
                    <h2 className="mt-1.5 font-[family-name:var(--font-display)] text-lg text-[var(--ink)] sm:text-xl">
                      “{turn.prompt}”
                    </h2>
                  </div>

                  <button
                    type="button"
                    className="node-action text-[var(--copper)]"
                    onClick={() => {
                      void sendToProjectRun(turn.prompt);
                    }}
                    title="Promote this inquiry into a pre-registered Econometric Run in your active Project"
                  >
                    Promote to Full Econometric Run ({activeProject?.title ?? "Project"}) →
                  </button>
                </div>

                {/* Data Status Banner */}
                {turn.dataStatusMessage ? (
                  <div className="mt-3 border border-[var(--line)] bg-[var(--bg)]/55 px-3.5 py-2.5 text-xs text-[var(--muted)]">
                    <strong className="text-[var(--copper)]">Live Evidence Status:</strong>{" "}
                    {turn.dataStatusMessage}
                  </div>
                ) : null}

                {/* Only render charts if real relevant live series were found (never forced generic charts) */}
                {turn.charts.length > 0 ? (
                  <div className="mt-4 space-y-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                      Live Series & Provenance Examined ({turn.charts.length})
                    </p>
                    <div className="grid gap-3 lg:grid-cols-2">
                      {turn.charts.map((series) => (
                        <FredSeriesChartCard key={series.key} series={series} />
                      ))}
                    </div>
                  </div>
                ) : null}

                {/* Streamed & Audited Persona Analysis */}
                <div className="mt-4">
                  {turn.text ? (
                    <AnalysisBody text={turn.text} />
                  ) : (
                    <p className="text-xs uppercase tracking-[0.14em] text-[var(--copper)]">
                      Querying live providers, running numeric audit, and composing simulated perspective…
                    </p>
                  )}
                </div>

                {/* Follow-up & Debate Chips */}
                {!turn.busy && turn.followUps.length > 0 ? (
                  <div className="mt-4 border-t border-[var(--line)] pt-3.5">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                      Challenge or Fork This Perspective
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
            placeholder="Ask a policy question in a simulated historical lens…"
            value={input}
            disabled={busy}
            onChange={(event) => setInput(event.target.value)}
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="composer-send"
          >
            {busy ? "Running…" : "Debate"}
          </button>
        </form>
      </section>
    </main>
  );
}
