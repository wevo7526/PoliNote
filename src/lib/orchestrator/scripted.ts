import { evTariffGraph, evTariffScope } from "@/data/ev-tariff-graph";
import type { DigressionEdge, DigressionNode } from "@/schemas/digression";
import type { ScopeContract } from "@/schemas/scope-contract";
import type { StudioOrchestratorEvent } from "./events";

const EV_HINT =
  /\b(ev|bev|electric vehicle|tariff|ad valorem|ira|auto employment)\b/i;

function nowIso(): string {
  return new Date().toISOString();
}

function slug(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 28);
  return cleaned || "question";
}

function looksLikeEvTariff(question: string): boolean {
  return EV_HINT.test(question);
}

function inferScope(question: string): ScopeContract {
  const ts = nowIso();
  return {
    id: `scope_${slug(question)}`,
    question,
    jurisdiction: "United States (assumed — confirm)",
    horizon: "Near-term (provisional)",
    objective: `Map mechanisms, evidence, and incidence for: ${question}`,
    instrument: "Inferred from the prompt — confirm before treating as locked",
    target: "Outcomes named or implied in the question",
    identificationStrategy:
      "Literature + series corroboration; causal claims stay proposed until evidence spans exist",
    distributionalCut: "Income / region if the instrument has a price channel",
    baseline: "Status quo policy unless a counterfactual is named",
    allowedMethods: ["literature", "time_series", "legal_text", "incidence", "counterfactual"],
    forbiddenMoves: [
      "Treat correlations as identification",
      "Mark a node supported without an MCP evidence span",
    ],
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

function genericGraph(question: string): {
  nodes: DigressionNode[];
  edges: DigressionEdge[];
} {
  const runId = `run_${slug(question)}_${Date.now().toString(36)}`;
  const ts = nowIso();
  const base = {
    runId,
    createdAt: ts,
    updatedAt: ts,
    provenance: [] as DigressionNode["provenance"],
    evidenceSpanIds: [] as string[],
  };

  const nodes: DigressionNode[] = [
    {
      ...base,
      id: `${runId}_claim`,
      kind: "claim",
      status: "proposed",
      title: "First-order effects are worth mapping before a verdict",
      body: `The question is treated as a live policy problem, not a chatbot prompt: “${question}”`,
      confidence: "low",
      agent: "scoper",
      position: { x: 420, y: 40 },
    },
    {
      ...base,
      id: `${runId}_mech`,
      kind: "mechanism",
      status: "proposed",
      title: "Instrument → relative prices → behavior",
      body: "Until the instrument is locked, the working mechanism is a price or constraint channel with incomplete pass-through.",
      confidence: "medium",
      agent: "instrument_parser",
      position: { x: 80, y: 200 },
    },
    {
      ...base,
      id: `${runId}_unc`,
      kind: "uncertainty",
      status: "proposed",
      title: "Identification is still open",
      body: "No MCP evidence span yet. Claims stay proposed; series-backed support waits on econ-series.",
      confidence: "high",
      agent: "critic",
      position: { x: 80, y: 400 },
    },
    {
      ...base,
      id: `${runId}_inc`,
      kind: "incidence",
      status: "proposed",
      title: "Who pays is a separate claim",
      body: "Incidence is not the same as the statutory target. Distributional cuts stay explicit.",
      confidence: "medium",
      agent: "incidence",
      position: { x: 760, y: 200 },
    },
    {
      ...base,
      id: `${runId}_fork`,
      kind: "fork",
      status: "proposed",
      title: "Fork: change the instrument or the horizon",
      body: "Reply in chat to prune this branch or force a different cut.",
      confidence: "unknown",
      agent: "scoper",
      position: { x: 760, y: 400 },
    },
  ];

  const edges: DigressionEdge[] = [
    {
      id: `${runId}_e1`,
      runId,
      sourceId: `${runId}_mech`,
      targetId: `${runId}_claim`,
      kind: "supports",
      label: "mechanism",
      createdAt: ts,
    },
    {
      id: `${runId}_e2`,
      runId,
      sourceId: `${runId}_unc`,
      targetId: `${runId}_claim`,
      kind: "attacks",
      label: "uncertainty",
      createdAt: ts,
    },
    {
      id: `${runId}_e3`,
      runId,
      sourceId: `${runId}_inc`,
      targetId: `${runId}_claim`,
      kind: "elaborates",
      createdAt: ts,
    },
    {
      id: `${runId}_e4`,
      runId,
      sourceId: `${runId}_fork`,
      targetId: `${runId}_claim`,
      kind: "alternatives",
      label: "fork",
      createdAt: ts,
    },
  ];

  return { nodes, edges };
}

const EV_REVEAL: Array<{
  nodeId?: string;
  edgeIds?: string[];
  agent: string;
  text: string;
}> = [
  {
    agent: "instrument_parser",
    text: "Instrument locked as a 25% ad valorem MFN tariff on imported BEVs (HS 8703). Target is retail prices, light-vehicle employment, and receipts.",
  },
  {
    nodeId: "n_legal_hs",
    agent: "legal",
    text: "Classification first. The tariff only binds if HS 8703 and MFN actually apply — otherwise the rest of the graph is theater.",
  },
  {
    nodeId: "n_claim_price",
    agent: "series",
    text: "Price claim goes up as proposed, not supported. Pass-through will not be 100%.",
  },
  {
    nodeId: "n_mech_passthrough",
    edgeIds: ["e1"],
    agent: "literature",
    text: "Mechanism: tariff × import share × pass-through. Literature band is wide — 0.4 to 0.8 — so the claim inherits that band.",
  },
  {
    nodeId: "n_ev_fred_cpi",
    edgeIds: ["e2"],
    agent: "series",
    text: "A FRED placeholder is pinned so the series agent has somewhere to hang observations. It is evidence-shaped, not yet a real vintage.",
  },
  {
    nodeId: "n_claim_emp",
    edgeIds: ["e8"],
    agent: "incidence",
    text: "Employment is a separate claim. Assembly gains and parts-chain losses can cancel. Status: contested.",
  },
  {
    nodeId: "n_inc_quintile",
    edgeIds: ["e6"],
    agent: "incidence",
    text: "Incidence cut: BEV buyers sit in Q4–Q5. Used-market spillover can hit Q2–Q3 later.",
  },
  {
    nodeId: "n_cf_no_ira",
    edgeIds: ["e5"],
    agent: "macro",
    text: "Counterfactual without IRA credits: pass-through rises, domestic-share response weakens.",
  },
  {
    nodeId: "n_unc_elasticity",
    edgeIds: ["e3"],
    agent: "critic",
    text: "Critic: the pass-through band is the whole story. Do not collapse it to a point estimate.",
  },
  {
    nodeId: "n_fork_retaliation",
    edgeIds: ["e7"],
    agent: "scoper",
    text: "A retaliation fork is parked, not expanded. Say prune or force if you want it grown.",
  },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export type ScriptedRunOptions = {
  signal?: AbortSignal;
  stepMs?: number;
};

async function emit(
  onEvent: (event: StudioOrchestratorEvent) => void,
  event: StudioOrchestratorEvent,
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  onEvent(event);
  if (ms > 0) await sleep(ms);
}

export async function runScriptedDigression(
  question: string,
  onEvent: (event: StudioOrchestratorEvent) => void,
  options: ScriptedRunOptions = {},
): Promise<void> {
  const step = options.stepMs ?? 720;
  const { signal } = options;
  const ev = looksLikeEvTariff(question);

  await emit(
    onEvent,
    {
      kind: "narration",
      agent: "scoper",
      text: ev
        ? "This reads as the EV-tariff question. I will lock a scope contract, then grow the digression one node at a time. Nothing is supported without an evidence span."
        : "Scope first. I will infer a working contract from your question, then grow a thin digression. Confirm instrument, target, identification, and horizon before we treat claims as ready.",
    },
    step,
    signal,
  );

  const contract = ev
    ? { ...evTariffScope, question, updatedAt: nowIso() }
    : inferScope(question);

  await emit(onEvent, { kind: "scope", contract }, step, signal);

  await emit(
    onEvent,
    {
      kind: "status",
      text: "Scope ready. Crew stepping: instrument → specialists → critic.",
    },
    Math.round(step * 0.7),
    signal,
  );

  if (ev) {
    const byId = new Map(evTariffGraph.nodes.map((node) => [node.id, node]));
    const edges = new Map(evTariffGraph.edges.map((edge) => [edge.id, edge]));

    for (const beat of EV_REVEAL) {
      await emit(
        onEvent,
        { kind: "narration", agent: beat.agent, text: beat.text },
        step,
        signal,
      );
      if (beat.nodeId) {
        const node = byId.get(beat.nodeId);
        if (node) {
          await emit(onEvent, { kind: "node", node }, Math.round(step * 0.55), signal);
        }
      }
      for (const edgeId of beat.edgeIds ?? []) {
        const edge = edges.get(edgeId);
        if (edge) {
          await emit(onEvent, { kind: "edge", edge }, 80, signal);
        }
      }
    }
  } else {
    const { nodes, edges } = genericGraph(question);
    const lines: Array<{ node: DigressionNode; agent: string; text: string }> = [
      {
        node: nodes[0],
        agent: "scoper",
        text: "Opening claim: we map first-order effects before anyone writes a brief.",
      },
      {
        node: nodes[1],
        agent: "instrument_parser",
        text: "Working mechanism is a price or constraint channel. Reply with a sharper instrument and I will rewrite this node.",
      },
      {
        node: nodes[3],
        agent: "incidence",
        text: "Incidence is its own claim — statutory target ≠ who pays.",
      },
      {
        node: nodes[2],
        agent: "critic",
        text: "No MCP span yet. Every supported badge is blocked until econ-series or literature returns one.",
      },
      {
        node: nodes[4],
        agent: "scoper",
        text: "A fork is parked for a different instrument or horizon. Chat to prune or force it.",
      },
    ];

    for (const line of lines) {
      await emit(
        onEvent,
        { kind: "narration", agent: line.agent, text: line.text },
        step,
        signal,
      );
      await emit(onEvent, { kind: "node", node: line.node }, Math.round(step * 0.5), signal);
    }
    for (const edge of edges) {
      await emit(onEvent, { kind: "edge", edge }, 60, signal);
    }
  }

  await emit(
    onEvent,
    {
      kind: "narration",
      agent: "trace_narrator",
      text: "Digression is on the table. Ask to prune a branch, swap the series, or tighten the scope — the next turn will only re-run the slice you change.",
    },
    200,
    signal,
  );
  onEvent({ kind: "done" });
}

export async function runFollowUp(
  message: string,
  ctx: { nodeCount: number },
  onEvent: (event: StudioOrchestratorEvent) => void,
  options: ScriptedRunOptions = {},
): Promise<void> {
  const step = options.stepMs ?? 560;
  const lower = message.toLowerCase();
  const prune = /\bprune|drop|kill the fork|remove (the )?branch\b/.test(lower);

  await emit(
    onEvent,
    {
      kind: "narration",
      agent: prune ? "critic" : "scoper",
      text: prune
        ? "Prune noted. In the live crew this invalidates the fork and any dependents, then re-ticks only that slice. Here it stays marked in the thread so you can see the move."
        : `Heard. ${ctx.nodeCount} nodes are already in the graph. The orchestrator will treat this as an annotation on the current digression — not a new run — until you change the scope contract.`,
    },
    step,
    options.signal,
  );

  if (/\bexport|brief|appendix\b/.test(lower)) {
    await emit(
      onEvent,
      {
        kind: "narration",
        agent: "synthesizer",
        text: "Export is not wired yet. When it is, every sentence in the brief will cite a node ID; ungrounded lines will be highlighted here in the same thread.",
      },
      200,
      options.signal,
    );
  }

  onEvent({ kind: "done" });
}
