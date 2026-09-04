import { generateText, streamText } from "ai";
import { openai } from "@ai-sdk/openai";
import { allowRoleAction } from "@/agents/walls";
import {
  type CrewStreamEvent,
  workingStatus,
} from "@/lib/ai/crew-events";
import {
  applyCriticWalls,
  draftCitesNodes,
  fallbackDraft,
  streamInstrumentParser,
  streamMcpSpecialists,
  streamTraceNarrator,
} from "@/lib/ai/crew-specialists";
import { ensureMcpTools } from "@/lib/mcp/register";
import { filterReputableHits } from "@/lib/sources/reputable";
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
  isScopeReady,
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

const DEFAULT_MODEL = "gpt-5.6-sol";
const FALLBACK_MODELS = ["gpt-5.6-terra", "gpt-4.1"];
const JSON_TIMEOUT_MS = 40_000;
const ANALYSIS_TIMEOUT_MS = 50_000;

const NARRATION_OPTIONS = {
  openai: {
    reasoningEffort: "high" as const,
    // Unverified orgs 400 if the SDK defaults this to "detailed".
    reasoningSummary: null,
  },
};

const JSON_OPTIONS = {
  openai: {
    reasoningEffort: "low" as const,
    reasoningSummary: null,
  },
};

const SCOPE_STYLE = `Write every scope field as a dense research-protocol paragraph, not a slogan or one-liner.

objective: Start with "Digress …". State the analytic task, the political coverage, the economic frame, and the first segment to start with before expanding.

instrument: Inventory the actual tools — appropriations, tax preferences, regulation, procurement, infrastructure, labor, marketing, and any request for federal action. Separate enacted policy, introduced legislation, executive budget proposals, formal campaign platforms, and general rhetoric.

target: Name the populations on both sides of the tradeoff and the outcome metrics you will benchmark (output, prices, employment, import share, public cost, resilience), including the comparison group.

identificationStrategy: Name the documentary inventory and the estimators (interrupted time series, difference-in-differences, event study, partial-equilibrium or input-output counterfactuals, benefit-incidence). List confounders. State what you will not treat as causal: partisan sponsorship, temporal coincidence, or stated intent.

horizon: Give explicit retrospective and prospective dates, and name the first segment to finish before considering expansion.

jurisdiction: Name the polity and the higher-law constraints (interstate commerce, international trade, federal farm/labor/safety/procurement rules).

baseline: The no-new-policy continuation as of the horizon's end date, what stays fixed federally, and the legally available counterfactuals. Note instruments the jurisdiction cannot use.

distributionalCut: Who pays and who gains along the supply chain and by region or income where the question requires it.`;

function isModelUnavailable(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : String(error);
  return /model|not found|does not exist|invalid_request|unsupported/i.test(raw) &&
    /model|gpt-|response_format|not found|does not exist|unsupported/i.test(raw);
}

function modelQueue(): string[] {
  const preferred = process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;
  return [preferred, ...FALLBACK_MODELS].filter(
    (id, index, all) => id.length > 0 && all.indexOf(id) === index,
  );
}

type ModelSlot = {
  id: string;
  demote: () => boolean;
};

function createModelSlot(): ModelSlot {
  const queue = modelQueue();
  let index = 0;
  return {
    get id() {
      return queue[index] ?? DEFAULT_MODEL;
    },
    demote() {
      if (index >= queue.length - 1) return false;
      index += 1;
      console.error("[polinote/crew] model unavailable, switching to", queue[index]);
      return true;
    },
  };
}

const AUTONOMY = `Infer missing policy details from the question and proceed. Do not ask clarifying questions. Do not stop for approval. Fill working values. Never mark a node supported.
Cite only real literature and official sources from the provided webLeads: NBER, journals, CRS, CBO, GAO, FRED/BLS/BEA, IMF, OECD, World Bank, Congress/govinfo, and comparable research shops.
Never cite Facebook, Reddit, Twitter/X, TikTok, Instagram, YouTube, LinkedIn, Quora, Wikipedia, Medium, Substack, or any social / user-generated page.
Never invent a paper, URL, or working-paper number. If a lead is missing, say the evidence is missing.`;

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

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    /aborted|abort|timeout/i.test(error instanceof Error ? error.message : String(error))
  );
}

function isReasoningSummaryError(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : String(error);
  return /verified to generate reasoning summaries|reasoning\.summary/i.test(raw);
}

function withTimeout(ms: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(text.replace(/,\s*([}\]])/g, "$1"));
  }
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced?.[1] ?? text).trim();
  const attempts: string[] = [raw];
  const objStart = raw.indexOf("{");
  const objEnd = raw.lastIndexOf("}");
  if (objStart !== -1 && objEnd > objStart) {
    attempts.push(raw.slice(objStart, objEnd + 1));
  }
  const arrStart = raw.indexOf("[");
  const arrEnd = raw.lastIndexOf("]");
  if (arrStart !== -1 && arrEnd > arrStart) {
    attempts.push(raw.slice(arrStart, arrEnd + 1));
  }
  for (const attempt of attempts) {
    try {
      return tryParseJson(attempt);
    } catch {
      continue;
    }
  }
  throw new Error("Model returned no JSON object");
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function fallbackScope(question: string): ScopeFields {
  const q = question.trim() || "the stated policy question";
  return {
    jurisdiction:
      "The polity named in the question, including federal or higher-law constraints that bind the instrument: interstate commerce, international trade, farm programs, labor, food safety, and procurement.",
    horizon:
      "Retrospective review of the last ten years of proposals and enacted policy, with prospective economic effects assessed over the following decade, unless the question names other dates. Finish the first named segment before expanding.",
    objective: `Digress a structured analysis of ${q}. Separate enacted policy, introduced legislation, executive proposals, campaign platforms, and rhetoric. Build the argument around the economic tradeoff the question names or implies, starting with the smallest concrete segment before expanding.`,
    instrument:
      "The policy tools named or implied in the question — appropriations, tax preferences, regulation, procurement, infrastructure, labor measures, and any request for federal tariff, trade, immigration, or farm-policy action. Separate enacted instruments from introduced bills, executive budget proposals, formal platforms, and general political rhetoric.",
    target:
      "The producers, workers, purchasers, and consumers on both sides of the localization-versus-import tradeoff, with outcomes benchmarked against the relevant comparison suppliers. Primary outcomes are output, prices, employment, import or inbound-shipment share, public expenditure, and supply resilience.",
    identificationStrategy:
      "Construct a proposal-level inventory from official legislation, budgets, executive documents, verifiable campaign materials, Congress or govinfo records, and official economic data. Estimate effects with interrupted time series, difference-in-differences, event studies, partial-equilibrium or input-output counterfactuals, and benefit-incidence analysis where those designs are credible. Do not infer causation from partisan sponsorship, temporal coincidence, or stated intent alone.",
    distributionalCut:
      "Winners and losers along the supply chain — producers, processors, distributors, workers, institutional buyers, and consumers — and by region or income where the question requires it.",
    baseline:
      "Continuation of policies in force at the end of the retrospective window, with sourcing following prevailing seasonal, interstate, and international patterns and no new localization mandate. Federal trade and immigration law stays fixed in the central baseline. Counterfactuals may only use instruments the jurisdiction can legally deploy.",
    allowedMethods: ["literature", "time_series", "legal_text", "macro", "incidence", "counterfactual"],
    forbiddenMoves: ["Do not mark nodes supported without an MCP evidence span"],
  };
}

function fallbackGraph(scope: ScopeFields): GraphStep {
  const clip = (text: string, n: number) =>
    text.length > n ? `${text.slice(0, n).trim()}…` : text;
  const nodes: RawNode[] = [
    {
      key: "claim_core",
      kind: "claim",
      status: "proposed",
      title: "Core policy claim",
      body: clip(scope.objective, 360),
      confidence: "unknown",
      agent: "literature",
      analysisTitle: "Core policy claim",
      analysis: scope.objective,
    },
    {
      key: "mech_channel",
      kind: "mechanism",
      status: "proposed",
      title: "Transmission mechanism",
      body: clip(scope.instrument, 360),
      confidence: "medium",
      agent: "literature",
      analysisTitle: "Transmission mechanism",
      analysis: scope.instrument,
    },
    {
      key: "inc_winners",
      kind: "incidence",
      status: "proposed",
      title: "Incidence of the tradeoff",
      body: clip(scope.distributionalCut, 360),
      confidence: "medium",
      agent: "incidence",
      analysisTitle: "Incidence of the tradeoff",
      analysis: scope.distributionalCut,
    },
    {
      key: "unc_id",
      kind: "uncertainty",
      status: "contested",
      title: "Identification limits",
      body: clip(scope.identificationStrategy, 360),
      confidence: "low",
      agent: "critic",
      analysisTitle: "Identification limits",
      analysis: scope.identificationStrategy,
    },
    {
      key: "cf_baseline",
      kind: "counterfactual",
      status: "proposed",
      title: "No-policy continuation",
      body: clip(scope.baseline, 360),
      confidence: "medium",
      agent: "literature",
      analysisTitle: "No-policy continuation",
      analysis: scope.baseline,
    },
    {
      key: "con_legal",
      kind: "constraint",
      status: "proposed",
      title: "Legal and jurisdictional bounds",
      body: clip(scope.jurisdiction, 360),
      confidence: "high",
      agent: "legal",
      analysisTitle: "Legal and jurisdictional bounds",
      analysis: scope.jurisdiction,
    },
  ];
  return {
    nodes,
    edges: [
      { sourceKey: "mech_channel", targetKey: "claim_core", kind: "supports" },
      { sourceKey: "claim_core", targetKey: "inc_winners", kind: "causal" },
      { sourceKey: "unc_id", targetKey: "claim_core", kind: "attacks" },
      { sourceKey: "cf_baseline", targetKey: "claim_core", kind: "alternatives" },
      { sourceKey: "con_legal", targetKey: "mech_channel", kind: "depends_on" },
    ],
  };
}

function coerceScope(raw: unknown, question: string): ScopeStep {
  const root = asRecord(raw);
  const scope = asRecord(root.scope ?? raw);
  const fallback = fallbackScope(question);
  const methods = asArray(scope.allowedMethods)
    .map((item) => pick(item, METHODS, "literature"))
    .filter((item, index, all) => all.indexOf(item) === index);
  return {
    runTitle: asString(root.runTitle, question).slice(0, 80),
    scope: {
      jurisdiction: asString(scope.jurisdiction, fallback.jurisdiction),
      horizon: asString(scope.horizon, fallback.horizon),
      objective: asString(scope.objective, fallback.objective),
      instrument: asString(scope.instrument, fallback.instrument),
      target: asString(scope.target, fallback.target),
      identificationStrategy: asString(
        scope.identificationStrategy,
        fallback.identificationStrategy,
      ),
      distributionalCut: asString(scope.distributionalCut, fallback.distributionalCut),
      baseline: asString(scope.baseline, fallback.baseline),
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

function stubAnalysis(node: RawNode): string {
  return [
    "## Mechanism",
    node.body,
    "",
    "## Incidence",
    "Incidence is still a working claim. Who pays and who gains has not been identified from an MCP span.",
    "",
    "## Identification",
    "This node is proposed from the scope contract and literature leads. It is not supported.",
    "",
    "## Sign flip",
    "The sign can flip if the comparison group, the instrument actually enacted, or the confounders named in the scope are wrong.",
    "",
    "## Missing evidence",
    "Needs an allowlisted series, statute, or paper span before the critic can move this node to supported.",
  ].join("\n");
}

function parseAnalyses(text: string): Map<string, { title: string; body: string }> {
  const map = new Map<string, { title: string; body: string }>();
  const chunks = text.split(/^@@\s*([a-z0-9_]+)\s*@@/im);
  for (let i = 1; i < chunks.length; i += 2) {
    const key = slugKey(chunks[i] ?? "");
    const body = (chunks[i + 1] ?? "").trim();
    if (!key || !body) continue;
    const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
    map.set(key, { title: heading || key.replace(/_/g, " "), body });
  }
  return map;
}

function coerceGraph(raw: unknown): GraphStep {
  const root = Array.isArray(raw) ? { nodes: raw, edges: [] } : asRecord(raw);
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
    return { nodes: [], edges: [] };
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
    provenance: filterReputableHits(web).slice(0, 2).map((hit) => ({
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
  sourceId: string,
  targetId: string,
  kind: DigressionEdgeKind,
  label: string | undefined,
  ts: string,
): DigressionEdge {
  return {
    id: `${runId}_e_${slugKey(sourceId)}_${slugKey(targetId)}_${kind}`.slice(0, 80),
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
    citations: filterReputableHits(web).map((hit) => ({
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
  model: ModelSlot;
}): AsyncGenerator<CrewStreamEvent, string> {
  const id = crypto.randomUUID();
  let useReasoning = true;
  for (;;) {
    try {
      const result = streamText({
        model: openai(input.model.id),
        providerOptions: useReasoning ? NARRATION_OPTIONS : undefined,
        system: `${AUTONOMY}\n${input.system}`,
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
      break;
    } catch (error) {
      console.error(
        "[polinote/crew] narration failed",
        input.agent,
        input.model.id,
        error instanceof Error ? error.message : error,
      );
      if (isReasoningSummaryError(error) && useReasoning) {
        useReasoning = false;
        continue;
      }
      if (isModelUnavailable(error) && input.model.demote()) continue;
      break;
    }
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

async function askJson(
  model: ModelSlot,
  system: string,
  prompt: string,
): Promise<unknown> {
  let useReasoning = true;
  for (;;) {
    const timeout = withTimeout(JSON_TIMEOUT_MS);
    try {
      const { text } = await generateText({
        model: openai(model.id),
        providerOptions: useReasoning ? JSON_OPTIONS : undefined,
        abortSignal: timeout.signal,
        system: `${AUTONOMY}\n${system}\nReturn ONLY a compact JSON object. No markdown fences. Keep string values short.`,
        prompt,
      });
      return extractJson(text);
    } catch (error) {
      console.error(
        "[polinote/crew] json call failed",
        model.id,
        error instanceof Error ? error.message : error,
      );
      if (isReasoningSummaryError(error) && useReasoning) {
        useReasoning = false;
        continue;
      }
      if (isAbortError(error)) throw new Error("Model returned no JSON object");
      if (isModelUnavailable(error) && model.demote()) continue;
      throw error;
    } finally {
      timeout.clear();
    }
  }
}

async function askAnalyses(
  model: ModelSlot,
  prompt: string,
): Promise<Map<string, { title: string; body: string }>> {
  let useReasoning = true;
  for (;;) {
    const timeout = withTimeout(ANALYSIS_TIMEOUT_MS);
    try {
      const { text } = await generateText({
        model: openai(model.id),
        providerOptions: useReasoning ? JSON_OPTIONS : undefined,
        abortSignal: timeout.signal,
        system: `${AUTONOMY}
Write a short analysis for EACH node. For every node emit a marker line, then markdown:

@@key@@
## Mechanism
## Incidence
## Identification
## Sign flip
## Missing evidence

One short paragraph per section. Cite only the provided webLeads. Never invent papers or URLs. Never use supported.`,
        prompt,
      });
      return parseAnalyses(text);
    } catch (error) {
      console.error(
        "[polinote/crew] analysis pass failed",
        error instanceof Error ? error.message : error,
      );
      if (isReasoningSummaryError(error) && useReasoning) {
        useReasoning = false;
        continue;
      }
      return new Map();
    } finally {
      timeout.clear();
    }
  }
}

export async function* streamCrewTurn(input: {
  runId: string;
  userId: string;
  question: string;
  latestMessage: string;
  prior?: {
    scope: ScopeContract | null;
    nodes?: DigressionNode[];
    nodeTitles: string[];
    nodeKeys: string[];
  };
}): AsyncGenerator<CrewStreamEvent> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set");
  }
  ensureMcpTools();

  const model = createModelSlot();
  const ts = nowIso();
  const revising = (input.prior?.nodeKeys.length ?? 0) > 0;
  yield workingStatus("Gathering web leads…");
  const web = await searchPolicyWeb(input.latestMessage || input.question);
  yield workingStatus(
    web.length
      ? `Scoper reading ${web.length} lead${web.length === 1 ? "" : "s"}…`
      : revising
        ? "Scoper refining the scope contract…"
        : "Scoper drafting the scope contract…",
  );

  const context = JSON.stringify({
    question: input.question,
    latestUserMessage: input.latestMessage,
    priorScope: input.prior?.scope ?? null,
    existingNodeTitles: input.prior?.nodeTitles ?? [],
    existingNodeKeys: input.prior?.nodeKeys ?? [],
    webLeads: web,
  });

  yield* streamNarration({
    agent: "scoper",
    model,
    fallback: "Locking a working scope so the rest of the crew can place nodes.",
    system: `You are PoliNote's scoper. Write 3–5 short paragraphs for a researcher.
Name the instrument, target, identification strategy, horizon, jurisdiction, and baseline in the long-form protocol style.
Say what is still missing. No JSON. Use blank lines between paragraphs.`,
    prompt: context,
  });

  let scopeOut: ScopeStep;
  try {
    scopeOut = coerceScope(
      await askJson(
        model,
        `You are PoliNote's scoper. Return JSON with runTitle and scope.
scope fields: jurisdiction, horizon, objective, instrument, target, identificationStrategy, distributionalCut, baseline, allowedMethods (from literature, time_series, legal_text, macro, incidence, counterfactual, expert_judgment), forbiddenMoves.
${SCOPE_STYLE}
${revising ? "A scope already exists. Refine it. Do not shrink fields into slogans." : "Write specific working values for THIS question."}
Each field is one dense paragraph (4–8 sentences). runTitle max 80 chars.`,
        context,
      ),
      input.question,
    );
  } catch (error) {
    console.error(
      "[polinote/crew] scope json failed, using fallback",
      error instanceof Error ? error.message : error,
    );
    scopeOut = coerceScope(input.prior?.scope ?? {}, input.question);
  }

  const contract = hydrateScope(input.runId, input.question, scopeOut.scope, ts);
  yield { type: "title", title: scopeOut.runTitle };
  yield {
    type: "scope",
    itemId: crypto.randomUUID(),
    contract,
  };

  if (!isScopeReady(contract)) {
    yield workingStatus(
      "Scope is incomplete. Lock instrument, target, identification, and horizon before the graph grows.",
    );
    yield { type: "done" };
    return;
  }

  const queries = yield* streamInstrumentParser({
    userId: input.userId,
    runId: input.runId,
    question: input.question,
    scope: scopeOut.scope,
  });

  const liveNodes = new Map<string, DigressionNode>();
  for (const node of input.prior?.nodes ?? []) {
    liveNodes.set(node.id, node);
  }

  yield workingStatus("Literature is placing the digression skeleton…");

  let graphOut: GraphStep;
  try {
    graphOut = coerceGraph(
      await askJson(
        model,
        revising
          ? `Return compact JSON: { "nodes": [...], "edges": [...] }.
Add 2–4 nodes that extend the existing graph, or revise existing keys.
Reuse keys when updating. Do not duplicate titles.
Each node: key, kind, title, body (2 sentences), status (proposed|contested), confidence, agent.
No analysis fields. Edges: sourceKey, targetKey, kind (supports|attacks|depends_on|elaborates|alternatives|causal).`
          : `Return compact JSON: { "nodes": [...], "edges": [...] }.
Exactly 6 nodes and 5–7 edges that form ONE connected argument under this scope.
Required kinds: claim, mechanism, incidence, uncertainty, counterfactual, and constraint or fork.
Each node: key, kind, title, body (2 sentences), status (proposed|contested), confidence, agent.
No analysis fields. Keys like claim_core, mech_channel, inc_region, unc_id, cf_baseline, con_legal.
Edges: sourceKey, targetKey, kind (supports|attacks|depends_on|elaborates|alternatives|causal).
The graph must be cohesive: every node attaches to the instrument → target → identification spine.`,
        JSON.stringify({
          question: input.question,
          latestUserMessage: input.latestMessage,
          scope: scopeOut.scope,
          existingNodeKeys: input.prior?.nodeKeys ?? [],
          existingNodeTitles: input.prior?.nodeTitles ?? [],
          webLeads: web,
        }),
      ),
    );
  } catch (error) {
    console.error(
      "[polinote/crew] skeleton json failed, using fallback graph",
      error instanceof Error ? error.message : error,
    );
    graphOut = revising ? { nodes: [], edges: [] } : fallbackGraph(scopeOut.scope);
  }

  if (graphOut.nodes.length === 0 && !revising) {
    graphOut = fallbackGraph(scopeOut.scope);
  }

  const keyToId = new Map<string, string>();
  for (const raw of graphOut.nodes) {
    raw.analysis = stubAnalysis(raw);
    raw.analysisTitle = raw.title;
    const node = hydrateNode(input.runId, raw, web, ts);
    keyToId.set(raw.key, node.id);
    keyToId.set(slugKey(raw.key), node.id);
    liveNodes.set(node.id, node);
    yield { type: "node", node };
    yield { type: "analysis", analysis: hydrateAnalysis(input.runId, raw, web) };
    await wait(60);
  }

  for (const edge of graphOut.edges) {
    const sourceId =
      keyToId.get(edge.sourceKey) ?? keyToId.get(slugKey(edge.sourceKey));
    const targetId =
      keyToId.get(edge.targetKey) ?? keyToId.get(slugKey(edge.targetKey));
    if (!sourceId || !targetId || sourceId === targetId) continue;
    yield {
      type: "edge",
      edge: hydrateEdge(
        input.runId,
        sourceId,
        targetId,
        edge.kind,
        edge.label,
        ts,
      ),
    };
  }

  if (graphOut.nodes.length > 0) {
    yield workingStatus("Literature is writing into the placed nodes…");
    yield* streamNarration({
      agent: "literature",
      model,
      fallback: "The skeleton is on the map. Filling mechanism, incidence, and missing-evidence notes.",
      system: `You are PoliNote's literature / mechanism / incidence crew.
Write 3–5 short paragraphs about the nodes that were JUST placed. Name them by title.
Stay on this instrument and this identification strategy. No JSON. Blank lines between paragraphs.`,
      prompt: JSON.stringify({
        question: input.question,
        scope: scopeOut.scope,
        nodes: graphOut.nodes.map((node) => ({
          key: node.key,
          kind: node.kind,
          title: node.title,
          body: node.body,
        })),
        webLeads: web,
      }),
    });

    const written = await askAnalyses(
      model,
      JSON.stringify({
        question: input.question,
        scope: scopeOut.scope,
        nodes: graphOut.nodes.map((node) => ({
          key: node.key,
          kind: node.kind,
          title: node.title,
          body: node.body,
        })),
        webLeads: web,
      }),
    );
    for (const raw of graphOut.nodes) {
      const hit = written.get(raw.key) ?? written.get(slugKey(raw.key));
      if (!hit) continue;
      raw.analysisTitle = hit.title;
      raw.analysis = hit.body;
      yield { type: "analysis", analysis: hydrateAnalysis(input.runId, raw, web) };
    }
  }

  const afterMcp = yield* streamMcpSpecialists({
    userId: input.userId,
    runId: input.runId,
    contract,
    scope: scopeOut.scope,
    queries,
    nodes: [...liveNodes.values()],
  });
  for (const node of afterMcp) {
    liveNodes.set(node.id, node);
  }

  yield workingStatus("Critic is reviewing the graph…");
  yield* streamNarration({
    agent: "critic",
    model,
    fallback: "Identification and incidence still need harder evidence before any node is supported.",
    system: `You are PoliNote's critic. Write 3–5 short paragraphs.
Attack identification, omitted channels, incidence hiding, and any claim that still lacks an MCP span.
You may not add positive claims or mark nodes supported. Name nodes by title. No JSON. Blank lines between paragraphs.`,
    prompt: JSON.stringify({
      question: input.question,
      scope: scopeOut.scope,
      nodes: [...liveNodes.values()].map((node) => ({
        id: node.id,
        kind: node.kind,
        title: node.title,
        status: node.status,
        spans: node.evidenceSpanIds,
      })),
    }),
  });

  const afterCritic = yield* applyCriticWalls([...liveNodes.values()]);
  for (const node of afterCritic) {
    liveNodes.set(node.id, node);
  }

  yield workingStatus("Synthesizer is writing the brief from node IDs…");
  const nodeList = [...liveNodes.values()];
  let draft = fallbackDraft(scopeOut.runTitle, input.question, nodeList);
  if (allowRoleAction("synthesizer", { type: "write_draft" })) {
    try {
      const raw = await askJson(
        model,
        `You are PoliNote's synthesizer. Return JSON { "brief", "appendix" }.
Every factual sentence must cite an existing node ID in square brackets, like [nodeId].
Cite only IDs from the provided list. No URLs. No new claims. Brief is public; appendix is technical.`,
        JSON.stringify({
          title: scopeOut.runTitle,
          question: input.question,
          nodes: nodeList.map((node) => ({
            id: node.id,
            kind: node.kind,
            title: node.title,
            body: node.body,
            status: node.status,
          })),
        }),
      );
      const parsed = asRecord(raw);
      const brief = asString(parsed.brief, "");
      const appendix = asString(parsed.appendix, "");
      if (brief && draftCitesNodes(`${brief}\n${appendix}`, nodeList)) {
        draft = { brief, appendix, updatedAt: nowIso() };
      }
    } catch (error) {
      console.error(
        "[polinote/crew] synthesizer json failed, using node-ID fallback",
        error instanceof Error ? error.message : error,
      );
    }
  }
  yield {
    type: "narration",
    item: {
      id: crypto.randomUUID(),
      kind: "narration",
      agent: "synthesizer",
      text: "Brief and appendix are on Draft. Every line is grounded in a node ID. Ungrounded sentences were dropped.",
    },
  };
  yield { type: "draft", brief: draft.brief, appendix: draft.appendix };

  yield* streamTraceNarrator({
    userId: input.userId,
    runId: input.runId,
    nodes: nodeList,
  });

  yield { type: "done" };
}
