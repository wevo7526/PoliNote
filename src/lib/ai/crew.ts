import { generateText, streamText } from "ai";
import { openai } from "@ai-sdk/openai";
import {
  type CrewStreamEvent,
  workingStatus,
} from "@/lib/ai/crew-events";
import { searchPolicyWeb, type WebHit } from "@/lib/tools/firecrawl";
import type { NodeAnalysis } from "@/schemas/analysis";
import {
  type ConfidenceBand,
  type DigressionEdge,
  type DigressionEdgeKind,
  type DigressionNode,
  type DigressionNodeKind,
  type DigressionNodeStatus,
} from "@/schemas/digression";
import {
  type AllowedMethod,
  type ScopeContract,
} from "@/schemas/scope-contract";

type ScopeFields = {
  jurisdiction: string;
  horizon: string;
  objective: string;
  instrument: string;
  target: string;
  identificationStrategy: string;
  distributionalCut: string;
  baseline: string;
  allowedMethods: AllowedMethod[];
  forbiddenMoves: string[];
};

type ScopeStep = {
  runTitle: string;
  scope: ScopeFields;
};

type RawNode = {
  key: string;
  kind: DigressionNodeKind;
  status: DigressionNodeStatus;
  title: string;
  body: string;
  confidence: ConfidenceBand;
  agent: string;
  analysisTitle: string;
  analysis: string;
};

type RawEdge = {
  sourceKey: string;
  targetKey: string;
  kind: DigressionEdgeKind;
  label?: string;
};

type GraphStep = {
  nodes: RawNode[];
  edges: RawEdge[];
};

const NODE_KINDS: DigressionNodeKind[] = [
  "claim",
  "mechanism",
  "constraint",
  "evidence",
  "counterfactual",
  "incidence",
  "uncertainty",
  "fork",
];

const EDGE_KINDS: DigressionEdgeKind[] = [
  "supports",
  "attacks",
  "depends_on",
  "elaborates",
  "alternatives",
  "causal",
];

const STATUSES: DigressionNodeStatus[] = [
  "proposed",
  "contested",
  "rejected",
  "pruned",
];

const CONFIDENCE: ConfidenceBand[] = ["low", "medium", "high", "unknown"];

const METHODS: AllowedMethod[] = [
  "literature",
  "time_series",
  "legal_text",
  "macro",
  "incidence",
  "counterfactual",
  "expert_judgment",
];

function nowIso(): string {
  return new Date().toISOString();
}

function modelName(): string {
  return process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
}

function slugKey(key: string): string {
  return key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 32);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const raw = typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, "_") : "";
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced?.[1] ?? text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("Model returned no JSON object");
  }
  return JSON.parse(raw.slice(start, end + 1));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function coerceScope(raw: unknown, question: string): ScopeStep {
  const root = asRecord(raw);
  const scope = asRecord(root.scope ?? raw);
  const methods = asArray(scope.allowedMethods)
    .map((item) => pick(item, METHODS, "literature"))
    .filter((item, index, all) => all.indexOf(item) === index);
  return {
    runTitle: asString(root.runTitle, question).slice(0, 80),
    scope: {
      jurisdiction: asString(scope.jurisdiction, "Unspecified"),
      horizon: asString(scope.horizon, "Near term"),
      objective: asString(scope.objective, question),
      instrument: asString(scope.instrument, "Policy instrument under review"),
      target: asString(scope.target, "Stated outcome"),
      identificationStrategy: asString(
        scope.identificationStrategy,
        "Comparative / observational identification",
      ),
      distributionalCut: asString(scope.distributionalCut, "Winners and losers"),
      baseline: asString(scope.baseline, "Current policy remains in force"),
      allowedMethods: methods.length > 0 ? methods : ["literature", "expert_judgment"],
      forbiddenMoves: asArray(scope.forbiddenMoves)
        .map((item) => asString(item, ""))
        .filter(Boolean)
        .concat(["Do not mark nodes supported without an MCP evidence span"])
        .slice(0, 8),
    },
  };
}

function coerceNode(raw: unknown, index: number): RawNode | null {
  const node = asRecord(raw);
  const title = asString(node.title, "");
  const key = slugKey(asString(node.key, title || `node_${index + 1}`));
  if (!title && !key) return null;
  const body = asString(node.body, title || "Proposed node");
  return {
    key: key || `node_${index + 1}`,
    kind: pick(node.kind, NODE_KINDS, "claim"),
    status: pick(node.status, STATUSES, "proposed"),
    title: title || key.replace(/_/g, " "),
    body,
    confidence: pick(node.confidence, CONFIDENCE, "unknown"),
    agent: asString(node.agent, "literature"),
    analysisTitle: asString(node.analysisTitle, title || "Analysis"),
    analysis: asString(node.analysis, body),
  };
}

function coerceGraph(raw: unknown): GraphStep {
  const root = asRecord(raw);
  const nodes = asArray(root.nodes)
    .map((item, index) => coerceNode(item, index))
    .filter((item): item is RawNode => item !== null)
    .slice(0, 8);
  const edges: RawEdge[] = [];
  for (const item of asArray(root.edges)) {
    const edge = asRecord(item);
    const sourceKey = slugKey(asString(edge.sourceKey, ""));
    const targetKey = slugKey(asString(edge.targetKey, ""));
    if (!sourceKey || !targetKey || sourceKey === targetKey) continue;
    edges.push({
      sourceKey,
      targetKey,
      kind: pick(edge.kind, EDGE_KINDS, "supports"),
      label: asString(edge.label, "") || undefined,
    });
  }

  if (nodes.length === 0) {
    throw new Error("Crew returned no usable nodes");
  }

  if (edges.length === 0 && nodes.length > 1) {
    for (let i = 0; i < nodes.length - 1; i += 1) {
      edges.push({
        sourceKey: nodes[i].key,
        targetKey: nodes[i + 1].key,
        kind: "elaborates",
      });
    }
  }

  return { nodes, edges };
}

function hydrateScope(
  runId: string,
  question: string,
  fields: ScopeFields,
  ts: string,
): ScopeContract {
  return {
    id: `${runId}_scope`,
    question,
    jurisdiction: fields.jurisdiction,
    horizon: fields.horizon,
    objective: fields.objective,
    instrument: fields.instrument,
    target: fields.target,
    identificationStrategy: fields.identificationStrategy,
    distributionalCut: fields.distributionalCut,
    baseline: fields.baseline,
    allowedMethods: fields.allowedMethods,
    forbiddenMoves: fields.forbiddenMoves,
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

function hydrateNode(
  runId: string,
  raw: RawNode,
  web: WebHit[],
  ts: string,
): DigressionNode {
  const key = slugKey(raw.key) || "node";
  return {
    id: `${runId}_${key}`,
    runId,
    kind: raw.kind,
    status: raw.status === "supported" ? "proposed" : raw.status,
    title: raw.title,
    body: raw.body,
    confidence: raw.confidence,
    agent: raw.agent,
    provenance: web.slice(0, 2).map((hit) => ({
      source: "web" as const,
      label: hit.title,
      url: hit.url,
    })),
    position: { x: 0, y: 0 },
    evidenceSpanIds: [],
    createdAt: ts,
    updatedAt: ts,
  };
}

function hydrateEdge(
  runId: string,
  index: number,
  sourceId: string,
  targetId: string,
  kind: DigressionEdgeKind,
  label: string | undefined,
  ts: string,
): DigressionEdge {
  return {
    id: `${runId}_e${index + 1}`,
    runId,
    sourceId,
    targetId,
    kind,
    label,
    createdAt: ts,
  };
}

function hydrateAnalysis(runId: string, raw: RawNode, web: WebHit[]): NodeAnalysis {
  return {
    nodeId: `${runId}_${slugKey(raw.key)}`,
    runId,
    title: raw.analysisTitle || raw.title,
    body: raw.analysis,
    citations: web.map((hit) => ({
      title: hit.title,
      url: hit.url,
      note: hit.snippet || undefined,
    })),
  };
}

async function* streamNarration(input: {
  agent: string;
  system: string;
  prompt: string;
  fallback: string;
}): AsyncGenerator<CrewStreamEvent, string> {
  const id = crypto.randomUUID();
  try {
    const result = streamText({
      model: openai(modelName()),
      system: input.system,
      prompt: input.prompt,
    });
    let full = "";
    for await (const delta of result.textStream) {
      if (!delta) continue;
      full += delta;
      yield {
        type: "narration_delta",
        id,
        agent: input.agent,
        delta,
      };
    }
    if (full.trim()) return full;
  } catch (error) {
    console.error(
      "[polinote/crew] narration failed",
      input.agent,
      error instanceof Error ? error.message : error,
    );
  }
  yield {
    type: "narration",
    item: {
      id,
      kind: "narration",
      agent: input.agent,
      text: input.fallback,
    },
  };
  return input.fallback;
}

async function askJson(system: string, prompt: string): Promise<unknown> {
  const { text } = await generateText({
    model: openai(modelName()),
    system: `${system}\nReturn ONLY a JSON object. No markdown.`,
    prompt,
  });
  return extractJson(text);
}

export async function* streamCrewTurn(input: {
  runId: string;
  question: string;
  latestMessage: string;
  prior?: {
    scope: ScopeContract | null;
    nodeTitles: string[];
  };
}): AsyncGenerator<CrewStreamEvent> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const ts = nowIso();
  yield workingStatus("Gathering web leads…");
  const web = await searchPolicyWeb(input.latestMessage || input.question);
  yield workingStatus(
    web.length
      ? `Scoper reading ${web.length} lead${web.length === 1 ? "" : "s"}…`
      : "Scoper drafting the scope contract…",
  );

  const context = JSON.stringify({
    question: input.question,
    latestUserMessage: input.latestMessage,
    priorScope: input.prior?.scope ?? null,
    existingNodeTitles: input.prior?.nodeTitles ?? [],
    webLeads: web,
  });

  yield* streamNarration({
    agent: "scoper",
    fallback: "Locking a working scope so the rest of the crew can place nodes.",
    system:
      "You are PoliNote's scoper. In 3–6 sentences, lock instrument, target, identification, and horizon for THIS question. No JSON.",
    prompt: context,
  });

  let scopeOut: ScopeStep;
  try {
    scopeOut = coerceScope(await askJson(
      `You are PoliNote's scoper. Return JSON with runTitle and scope.
scope needs: jurisdiction, horizon, objective, instrument, target, identificationStrategy, distributionalCut, baseline, allowedMethods (from literature, time_series, legal_text, macro, incidence, counterfactual, expert_judgment), forbiddenMoves.
Fill instrument, target, identification strategy, and horizon. runTitle max 80 chars.`,
      context,
    ), input.question);
  } catch (error) {
    console.error(
      "[polinote/crew] scope json failed, using fallback",
      error instanceof Error ? error.message : error,
    );
    scopeOut = coerceScope({}, input.question);
  }

  yield { type: "title", title: scopeOut.runTitle };
  yield {
    type: "scope",
    itemId: crypto.randomUUID(),
    contract: hydrateScope(input.runId, input.question, scopeOut.scope, ts),
  };

  yield workingStatus("Literature and mechanism agents are placing nodes…");

  yield* streamNarration({
    agent: "literature",
    fallback: "Placing claims, mechanisms, and uncertainties on the map.",
    system:
      "You are PoliNote's literature / mechanism crew. In 3–6 sentences, say which claims, mechanisms, and uncertainties you are about to place. No JSON.",
    prompt: JSON.stringify({
      question: input.question,
      scope: scopeOut.scope,
      webLeads: web,
    }),
  });

  let graphOut: GraphStep;
  try {
    graphOut = coerceGraph(await askJson(
      `You are PoliNote's literature / mechanism / incidence crew.
Return JSON: { "nodes": [...], "edges": [...] }.
4–6 nodes. Each node: key, kind (claim|mechanism|constraint|evidence|counterfactual|incidence|uncertainty|fork), title, body, analysis, optional status (proposed|contested), confidence, agent, analysisTitle.
Never use supported.
Edges: sourceKey, targetKey, kind (supports|attacks|depends_on|elaborates|alternatives|causal).
Keys like claim_price, mech_pass. Body and analysis can be 2–4 sentences.
Web snippets are unverified leads, not proof.`,
      JSON.stringify({
        question: input.question,
        latestUserMessage: input.latestMessage,
        scope: scopeOut.scope,
        existingNodeTitles: input.prior?.nodeTitles ?? [],
        webLeads: web,
      }),
    ));
  } catch (error) {
    console.error(
      "[polinote/crew] graph json failed, retrying simpler",
      error instanceof Error ? error.message : error,
    );
    graphOut = coerceGraph(await askJson(
      `Return JSON only: { "nodes": [ { "key": "claim_1", "kind": "claim", "title": "...", "body": "...", "analysis": "..." } ], "edges": [ { "sourceKey": "claim_1", "targetKey": "mech_1", "kind": "supports" } ] }.
Give 4 nodes and 3 edges for this policy question. Short strings. No markdown.`,
      input.latestMessage || input.question,
    ));
  }

  const keyToId = new Map<string, string>();
  for (const raw of graphOut.nodes) {
    const node = hydrateNode(input.runId, raw, web, ts);
    keyToId.set(raw.key, node.id);
    keyToId.set(slugKey(raw.key), node.id);
    yield { type: "node", node };
    yield { type: "analysis", analysis: hydrateAnalysis(input.runId, raw, web) };
    await wait(90);
  }

  for (const [index, edge] of graphOut.edges.entries()) {
    const sourceId =
      keyToId.get(edge.sourceKey) ?? keyToId.get(slugKey(edge.sourceKey));
    const targetId =
      keyToId.get(edge.targetKey) ?? keyToId.get(slugKey(edge.targetKey));
    if (!sourceId || !targetId || sourceId === targetId) continue;
    yield {
      type: "edge",
      edge: hydrateEdge(
        input.runId,
        index,
        sourceId,
        targetId,
        edge.kind,
        edge.label,
        ts,
      ),
    };
  }

  yield workingStatus("Critic is reviewing the graph…");
  yield* streamNarration({
    agent: "critic",
    fallback: "Identification and incidence still need harder evidence before any node is supported.",
    system:
      "You are PoliNote's critic. Challenge identification, incidence, and missing evidence on THIS graph. 3–6 sentences. No JSON.",
    prompt: JSON.stringify({
      question: input.question,
      scope: scopeOut.scope,
      nodes: graphOut.nodes.map((node) => ({
        key: node.key,
        kind: node.kind,
        title: node.title,
        body: node.body,
      })),
    }),
  });

  yield { type: "done" };
}
