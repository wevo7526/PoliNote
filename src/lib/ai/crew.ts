import { gateway, generateText, streamText, type LanguageModel } from "ai";
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
  normalizeNodeCitations,
  streamInstrumentParser,
  streamMcpSpecialists,
  streamTraceNarrator,
} from "@/lib/ai/crew-specialists";
import {
  auditGeneratedProseNumbers,
  buildAllowedNumericRegistry,
} from "@/lib/economics/auditor";
import type { EconometricMethodId } from "@/lib/economics/schemas";
import { shortNodeKey } from "@/lib/ui/prose";
import { redactSecrets } from "@/lib/mcp/http";
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
  hypothesizedDirection: "positive" | "negative" | "ambiguous";
  preferredMethod: EconometricMethodId;
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

const ECONOMETRIC_METHODS: EconometricMethodId[] = [
  "event_study",
  "local_projections_jorda",
  "arima_forecast_counterfactual",
  "descriptive_newey_west",
  "did_twfe",
  "synthetic_control",
  "chow_break_test",
  "bai_perron_break",
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
    reasoningEffort: "low" as const,
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

objective: Start with "Digress …". State the analytic task, the hypothesized direction, the unit of analysis, and the policy date(s).

instrument: Inventory the statutory tools — appropriations, tax rates, tariffs, regulation, procurement, or monetary rules. Separate enacted policy from proposals.

target: Name the outcome series to be estimated, the unit of analysis, geography, and treatment/control candidates.

identificationStrategy: Name the econometric estimator from the catalog (Event Study, Jordà Local Projections, Difference-in-Differences, Synthetic Control, ARIMA Counterfactual, Chow/Bai-Perron Break Test), its identifying assumptions, and named confounders in the observation window.

horizon: Give explicit pre-policy and post-policy dates (at least 5 years pre-policy through latest available).

jurisdiction: Name the polity and higher-law constraints.

baseline: The pre-policy counterfactual trajectory absent the policy intervention.

distributionalCut: Who bears the economic vs. statutory incidence across households, firms, labor, and public budgets.`;

function isModelUnavailable(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : String(error);
  return (
    /model|not found|does not exist|invalid_request|unsupported/i.test(raw) &&
    /model|gpt-|response_format|not found|does not exist|unsupported/i.test(raw)
  );
}

export function hasAiCredentials(): boolean {
  return Boolean(
    process.env.OPENAI_API_KEY?.trim() ||
      process.env.AI_GATEWAY_API_KEY?.trim() ||
      process.env.VERCEL_OIDC_TOKEN?.trim(),
  );
}

export function resolveAiModel(modelId: string): LanguageModel {
  const cleanId = modelId.replace(/^openai\//, "");
  if (process.env.OPENAI_API_KEY?.trim()) {
    return openai(cleanId);
  }
  return gateway(`openai/${cleanId}`);
}

function modelQueue(): string[] {
  const preferred =
    process.env.OPENAI_MODEL?.trim() ||
    process.env.AI_GATEWAY_MODEL?.trim() ||
    DEFAULT_MODEL;
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

const AUTONOMY = `Infer missing policy details from the question and proceed. Do not ask clarifying questions.
NON-NEGOTIABLE NUMERIC RULE: You (the LLM) must NEVER invent, guess, or fabricate any number, percentage, elasticity, or series value.
Only cite exact numbers present in the provided econometric estimates, live observations, or quote-backed literature. If a number is not in the provided data, do not write a number—state that live data is required.
Never mark a node supported. Cite only real literature and official sources.`;

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

function pick<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  const raw =
    typeof value === "string"
      ? value.trim().toLowerCase().replace(/[\s-]+/g, "_")
      : "";
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    /aborted|abort|timeout/i.test(
      error instanceof Error ? error.message : String(error),
    )
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
      "The polity named in the question, including statutory and higher-law constraints that bind the policy instrument.",
    horizon:
      "At least 6 years of pre-policy historical observations through the latest available release date to test pre-trends and dynamic post-policy responses.",
    objective: `Digress a pre-registered econometric and institutional analysis of ${q}. Separate statutory authority, transmission mechanisms, live empirical series, and distributional incidence.`,
    instrument:
      "The concrete policy instrument named or implied in the question — tariffs, tax provisions, appropriations, regulatory mandates, or monetary rules.",
    target:
      "Primary macroeconomic and sector outcome series fetched live from official statistical providers (FRED/ALFRED, BEA, BLS, Census, World Bank).",
    identificationStrategy:
      "Pre-registered Event Study with lead/lag pre-trend F-test and Jordà Local Projections with Newey–West HAC standard errors, supplemented by automatic specification curve robustness checks across windows, transforms, and in-time placebos.",
    distributionalCut:
      "Statutory vs. economic incidence across households, domestic producers, downstream input-using firms, workers, and public budgets.",
    baseline:
      "Pre-policy counterfactual trajectory projected forward with explicit confidence intervals.",
    allowedMethods: [
      "literature",
      "time_series",
      "legal_text",
      "macro",
      "incidence",
      "counterfactual",
    ],
    forbiddenMoves: [
      "Never fabricate or hard-code economic numbers",
      "Never mark claims supported without a computed econometric estimate",
    ],
  };
}

function fallbackGraph(scope: ScopeFields): GraphStep {
  const clip = (text: string, n: number) =>
    text.length > n ? `${text.slice(0, n).trim()}…` : text;
  const nodes: RawNode[] = [
    {
      key: "con_legal",
      kind: "constraint",
      status: "proposed",
      title: "Statutory instrument & authority",
      body: clip(scope.instrument, 340),
      confidence: "unknown",
      agent: "scoper",
      analysisTitle: "Statutory instrument & authority",
      analysis: scope.instrument,
    },
    {
      key: "mech_channel",
      kind: "mechanism",
      status: "proposed",
      title: "Transmission mechanism & identification",
      body: clip(scope.identificationStrategy, 340),
      confidence: "unknown",
      agent: "identification_strategist",
      analysisTitle: "Transmission mechanism & identification",
      analysis: scope.identificationStrategy,
    },
    {
      key: "claim_core",
      kind: "claim",
      status: "proposed",
      title: "Primary testable policy claim",
      body: clip(scope.objective, 340),
      confidence: "unknown",
      agent: "scoper",
      analysisTitle: "Primary testable policy claim",
      analysis: scope.objective,
    },
    {
      key: "inc_winners",
      kind: "incidence",
      status: "proposed",
      title: "Distributional & sectoral incidence",
      body: clip(scope.distributionalCut, 340),
      confidence: "unknown",
      agent: "econometrician",
      analysisTitle: "Distributional & sectoral incidence",
      analysis: scope.distributionalCut,
    },
    {
      key: "unc_id",
      kind: "uncertainty",
      status: "contested",
      title: "Skeptic red-team critique & confounders",
      body: "Evaluates contemporaneous macro shocks, reverse causality, pre-trend stability, and specification curve fragility.",
      confidence: "unknown",
      agent: "skeptic",
      analysisTitle: "Skeptic red-team critique & confounders",
      analysis: scope.identificationStrategy,
    },
    {
      key: "cf_baseline",
      kind: "counterfactual",
      status: "proposed",
      title: "Pre-policy counterfactual & fork candidate",
      body: clip(scope.baseline, 340),
      confidence: "unknown",
      agent: "identification_strategist",
      analysisTitle: "Pre-policy counterfactual & fork candidate",
      analysis: scope.baseline,
    },
  ];
  return {
    nodes,
    edges: [
      { sourceKey: "con_legal", targetKey: "mech_channel", kind: "depends_on" },
      { sourceKey: "mech_channel", targetKey: "claim_core", kind: "supports" },
      { sourceKey: "claim_core", targetKey: "inc_winners", kind: "causal" },
      { sourceKey: "unc_id", targetKey: "claim_core", kind: "attacks" },
      { sourceKey: "cf_baseline", targetKey: "claim_core", kind: "alternatives" },
    ],
  };
}

function coerceScope(raw: unknown, question: string): ScopeStep {
  const root = asRecord(raw);
  const scope = asRecord(root.scope ?? raw);
  const fallback = fallbackScope(question);
  const methods = asArray(scope.allowedMethods)
    .map((item) => pick(item, METHODS, "literature"))
    .concat(["literature", "time_series", "legal_text", "macro", "incidence"])
    .filter((item, index, all) => all.indexOf(item) === index);
  const hypothesizedDirection = pick(
    root.hypothesizedDirection,
    ["positive", "negative", "ambiguous"] as const,
    "ambiguous",
  );
  const preferredMethod = pick(
    root.preferredMethod,
    ECONOMETRIC_METHODS,
    "event_study",
  );
  return {
    runTitle: asString(root.runTitle, question).slice(0, 80),
    hypothesizedDirection,
    preferredMethod,
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
      distributionalCut: asString(
        scope.distributionalCut,
        fallback.distributionalCut,
      ),
      baseline: asString(scope.baseline, fallback.baseline),
      allowedMethods:
        methods.length > 0 ? methods : ["literature", "expert_judgment"],
      forbiddenMoves: asArray(scope.forbiddenMoves)
        .map((item) => asString(item, ""))
        .filter(Boolean)
        .concat([
          "Never fabricate economic numbers",
          "Never mark nodes supported without a computed econometric estimate",
        ])
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
    agent: asString(node.agent, "literature_analyst"),
    analysisTitle: asString(node.analysisTitle, title || "Analysis"),
    analysis: asString(node.analysis, body),
  };
}

function stubAnalysis(node: RawNode): string {
  return [
    "## Mechanism",
    `${node.body}`,
    "",
    "## Identification",
    "Evaluated via pre-registered econometric specification on live provider series with Newey–West HAC standard errors.",
    "",
    "## Incidence",
    "Separates statutory compliance from economic incidence across households, domestic producers, downstream firms, labor, and public revenue.",
    "",
    "## Sign flip",
    "Tested automatically across alternative observation windows, transforms, controls, and in-time placebo dates.",
    "",
    "## Missing evidence",
    "Awaiting live series observations and quote-backed literature spans.",
  ].join("\n");
}

function parseAnalyses(
  text: string,
): Map<string, { title: string; body: string }> {
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
        sourceKey: nodes[i]!.key,
        targetKey: nodes[i + 1]!.key,
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
  hypothesizedDirection?: "positive" | "negative" | "ambiguous",
): DigressionNode {
  const key = slugKey(raw.key) || "node";
  return {
    id: `${runId}_${key}`,
    runId,
    kind: raw.kind,
    status: raw.status === "supported" ? "proposed" : raw.status,
    title: raw.title,
    body: raw.body,
    confidence: "unknown",
    hypothesizedDirection:
      raw.kind === "claim" ? hypothesizedDirection : undefined,
    agent: raw.agent,
    provenance: filterReputableHits(web)
      .slice(0, 2)
      .map((hit) => ({
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
    id: `${runId}_e_${slugKey(sourceId)}_${slugKey(targetId)}_${kind}`.slice(
      0,
      80,
    ),
    runId,
    sourceId,
    targetId,
    kind,
    label,
    createdAt: ts,
  };
}

function hydrateAnalysis(
  runId: string,
  raw: RawNode,
  web: WebHit[],
): NodeAnalysis {
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
        model: resolveAiModel(model.id),
        providerOptions: useReasoning ? JSON_OPTIONS : undefined,
        abortSignal: timeout.signal,
        system: `${AUTONOMY}\n${system}\nReturn ONLY a compact JSON object. No markdown fences. Keep string values concise.`,
        prompt,
      });
      return extractJson(text);
    } catch (error) {
      console.error(
        "[polinote/crew] json call failed",
        model.id,
        error instanceof Error ? redactSecrets(error.message) : "json error",
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
        model: resolveAiModel(model.id),
        providerOptions: useReasoning ? JSON_OPTIONS : undefined,
        abortSignal: timeout.signal,
        system: `${AUTONOMY}
Write a short analysis for EACH node. For every node emit a marker line, then markdown:

@@key@@
## Mechanism
## Identification
## Incidence
## Sign flip
## Missing evidence

One short paragraph per section. Cite ONLY numbers present in the provided estimates or mcpSpans. Never invent numbers, papers, or URLs.`,
        prompt,
      });
      return parseAnalyses(text);
    } catch (error) {
      console.error(
        "[polinote/crew] analysis pass failed",
        error instanceof Error ? redactSecrets(error.message) : "analysis error",
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
  projectContext?: string;
  prior?: {
    scope: ScopeContract | null;
    nodes?: DigressionNode[];
    nodeTitles: string[];
    nodeKeys: string[];
  };
}): AsyncGenerator<CrewStreamEvent> {
  if (!hasAiCredentials()) {
    throw new Error("OPENAI_API_KEY or Vercel AI Gateway OIDC is not set");
  }
  ensureMcpTools();

  const model = createModelSlot();
  const ts = nowIso();
  const revising = (input.prior?.nodeKeys.length ?? 0) > 0;
  yield workingStatus("Step 1/7 · Scoper & Literature intake…");
  const web = await searchPolicyWeb(input.latestMessage || input.question);

  const context = JSON.stringify({
    question: input.question,
    latestUserMessage: input.latestMessage,
    projectContext: input.projectContext || undefined,
    priorScope: input.prior?.scope ?? null,
    existingNodeTitles: input.prior?.nodeTitles ?? [],
    existingNodeKeys: input.prior?.nodeKeys ?? [],
    webLeads: web,
  });

  let scopeOut: ScopeStep;
  try {
    scopeOut = coerceScope(
      await askJson(
        model,
        `You are PoliNote's Scoper & Identification Strategist. Return JSON with:
- runTitle (max 80 chars)
- hypothesizedDirection ("positive" | "negative" | "ambiguous")
- preferredMethod ("event_study" | "local_projections_jorda" | "arima_forecast_counterfactual" | "descriptive_newey_west" | "did_twfe" | "synthetic_control")
- scope: { jurisdiction, horizon, objective, instrument, target, identificationStrategy, distributionalCut, baseline, allowedMethods, forbiddenMoves }
${SCOPE_STYLE}
Do not invent any empirical numbers in the scope.`,
        context,
      ),
      input.question,
    );
  } catch (error) {
    console.error(
      "[polinote/crew] scope json failed, using fallback",
      error instanceof Error ? redactSecrets(error.message) : "scope error",
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

  yield {
    type: "narration",
    item: {
      id: crypto.randomUUID(),
      kind: "narration",
      agent: "scoper",
      text: `Locked Scope Contract for “${scopeOut.runTitle}” (hypothesized direction: ${scopeOut.hypothesizedDirection}, primary estimator: ${scopeOut.preferredMethod}).`,
    },
  };

  if (!isScopeReady(contract)) {
    yield workingStatus(
      "Scope is incomplete. Lock instrument, target, identification, and horizon before the graph grows.",
    );
    yield { type: "done" };
    return;
  }

  yield workingStatus("Step 2/7 · Pre-registration lock & Data Scout query planning…");
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

  yield workingStatus("Step 3/7 · Identification Strategist & Literature Analyst placing spine…");

  let graphOut: GraphStep;
  try {
    graphOut = coerceGraph(
      await askJson(
        model,
        revising
          ? `Return compact JSON: { "nodes": [...], "edges": [...] }.
Add 2–4 nodes that extend the existing graph, or revise existing keys.
Each node: key, kind, title, body (2 sentences, NO fabricated numbers), status (proposed|contested), confidence, agent (scoper|identification_strategist|econometrician|literature_analyst|skeptic).
Edges: sourceKey, targetKey, kind (supports|attacks|depends_on|elaborates|alternatives|causal).`
          : `Return compact JSON: { "nodes": [...], "edges": [...] }.
Exactly 6 nodes and 5–7 edges that form ONE connected argument under this scope.
Spine first (required kinds): constraint (instrument), mechanism, claim, incidence.
Then digressions: uncertainty (skeptic critique) and either counterfactual or fork.
Each node: key, kind, title, body (2 sentences, DO NOT invent any statistics or numbers), status (proposed|contested), confidence, agent (scoper|identification_strategist|econometrician|literature_analyst|skeptic).
Keys like con_legal, mech_channel, claim_core, inc_region, unc_id, cf_baseline.`,
        JSON.stringify({
          question: input.question,
          latestUserMessage: input.latestMessage,
          projectContext: input.projectContext || undefined,
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
      error instanceof Error ? redactSecrets(error.message) : "skeleton error",
    );
    graphOut = revising ? { nodes: [], edges: [] } : fallbackGraph(scopeOut.scope);
  }

  if (graphOut.nodes.length === 0 && !revising) {
    graphOut = fallbackGraph(scopeOut.scope);
  }

  const keyToId = new Map<string, string>();
  for (const node of liveNodes.values()) {
    keyToId.set(node.id, node.id);
    keyToId.set(shortNodeKey(node.id), node.id);
    keyToId.set(slugKey(shortNodeKey(node.id)), node.id);
  }

  const emittedEdgeIds = new Set<string>();
  for (const raw of graphOut.nodes) {
    raw.analysis = stubAnalysis(raw);
    raw.analysisTitle = raw.title;
    const node = hydrateNode(
      input.runId,
      raw,
      web,
      ts,
      scopeOut.hypothesizedDirection,
    );
    keyToId.set(raw.key, node.id);
    keyToId.set(slugKey(raw.key), node.id);
    liveNodes.set(node.id, node);
    yield { type: "node", node };
    yield { type: "analysis", analysis: hydrateAnalysis(input.runId, raw, web) };

    for (const edge of graphOut.edges) {
      const sourceId =
        keyToId.get(edge.sourceKey) ?? keyToId.get(slugKey(edge.sourceKey));
      const targetId =
        keyToId.get(edge.targetKey) ?? keyToId.get(slugKey(edge.targetKey));
      if (!sourceId || !targetId || sourceId === targetId) continue;
      const hydrated = hydrateEdge(
        input.runId,
        sourceId,
        targetId,
        edge.kind,
        edge.label,
        ts,
      );
      if (emittedEdgeIds.has(hydrated.id)) continue;
      emittedEdgeIds.add(hydrated.id);
      yield { type: "edge", edge: hydrated };
    }
    await wait(30);
  }

  // Step 4 & 5: Live Data Pull, Econometric Estimation, and Automatic Robustness Suite
  yield workingStatus("Step 4/7 · Fetching live series & running econometric estimation…");
  const mcpResult = yield* streamMcpSpecialists({
    userId: input.userId,
    runId: input.runId,
    contract,
    scope: scopeOut.scope,
    queries,
    nodes: [...liveNodes.values()],
    preferredMethod: scopeOut.preferredMethod,
    hypothesizedDirection: scopeOut.hypothesizedDirection,
  });
  for (const node of mcpResult.nodes) {
    liveNodes.set(node.id, node);
  }

  const mcpSpanDigest = mcpResult.spans.map((span) => ({
    id: span.id,
    server: span.server,
    tool: span.tool,
    citation: span.citation,
    seriesId: span.seriesId,
    units: span.units,
    vintage: span.vintage,
    sha256: span.resultHash.slice(0, 16),
    earliestPoint: span.seriesPoints?.[0],
    latestPoint: span.seriesPoints?.[span.seriesPoints.length - 1],
    sampleSize: span.seriesPoints?.length ?? 0,
  }));

  const estimateDigest = mcpResult.estimates.map((est) => ({
    id: est.id,
    method: est.methodLabel,
    honestyLabel: est.honestyLabel,
    seriesId: est.spec.outcomeSeriesId,
    pointEstimate: est.pointEstimate,
    standardError: est.standardError,
    ciLower: est.ciLower,
    ciUpper: est.ciUpper,
    pValue: est.pValue,
    sampleSize: est.sampleSize,
    window: est.sampleWindow,
    seMethod: est.seMethod,
    preTrendPValue: est.diagnostics.preTrendPValue,
    preRegistrationHash: est.spec.preRegistration.lockHash.slice(0, 12),
  }));

  const robustnessDigest = mcpResult.robustness.map((r) => ({
    headlineEstimateId: r.headlineEstimateId,
    passRatePct: Math.round(r.passRate * 100),
    signFlipped: r.signFlipped,
    significanceFlipped: r.significanceFlipped,
    placeboPassed: r.placeboPassed,
    summary: r.summary,
    specs: r.specs,
  }));

  // Step 6: Skeptic / Red Team & Verification Wall
  yield workingStatus("Step 6/7 · Skeptic Red-Team critique & verification wall…");
  const afterCritic = yield* applyCriticWalls([...liveNodes.values()]);
  for (const node of afterCritic) {
    liveNodes.set(node.id, node);
  }

  const nodeList = [...liveNodes.values()];
  const supportedNodes = nodeList.filter((n) => n.status === "supported");
  const contradictedNodes = nodeList.filter((n) => n.status === "contradicted");
  const inconclusiveNodes = nodeList.filter((n) => n.status === "inconclusive");
  const unverifiableNodes = nodeList.filter((n) => n.status === "unverifiable");

  yield {
    type: "narration",
    item: {
      id: crypto.randomUUID(),
      kind: "narration",
      agent: "skeptic",
      text:
        mcpResult.estimates.length > 0
          ? `Skeptic Red-Team & Code Verification Audit: ${supportedNodes.length} claim(s) supported, ${contradictedNodes.length} contradicted, ${inconclusiveNodes.length} inconclusive. What would change my mind: (1) Fork the observation window to exclude post-2020 pandemic volatility; (2) Re-estimate in first-differences / log-changes; (3) Include a macro control series to test for omitted variable bias.`
          : `Skeptic & Verification Audit: ${unverifiableNodes.length} claim(s) marked UNVERIFIABLE because live series observations were unavailable (${mcpResult.dataErrors[0] ?? "no provider key configured"}). Zero fallback numbers were substituted.`,
    },
  };

  yield workingStatus(
    "Step 7/7 · Synthesizer writing brief & Data Auditor verifying every number…",
  );

  // Build the deterministic allowed numeric registry for the Data Auditor
  const numericRegistry = buildAllowedNumericRegistry({
    bundles: mcpResult.bundles,
    estimates: mcpResult.estimates,
    robustness: mcpResult.robustness,
    literature: mcpResult.literatureEstimates,
  });

  let draft = fallbackDraft(
    scopeOut.runTitle,
    input.question,
    nodeList,
    mcpResult.estimates,
    mcpResult.dataErrors,
  );

  const analysesTask =
    graphOut.nodes.length > 0
      ? askAnalyses(
          model,
          JSON.stringify({
            question: input.question,
            scope: scopeOut.scope,
            mcpSpans: mcpSpanDigest,
            estimates: estimateDigest,
            robustness: robustnessDigest,
            literatureEstimates: mcpResult.literatureEstimates,
            dataErrors: mcpResult.dataErrors,
            nodes: graphOut.nodes.map((node) => ({
              key: node.key,
              kind: node.kind,
              title: node.title,
              body: node.body,
            })),
            webLeads: web,
          }),
        )
      : Promise.resolve(new Map<string, { title: string; body: string }>());

  const synthTask = allowRoleAction("synthesizer", { type: "write_draft" })
    ? askJson(
        model,
        `You are PoliNote's Synthesizer. Return JSON { "brief", "appendix" }.
Every factual sentence MUST cite an existing node short key in square brackets, like [claim_core] or [ev_fred].
CRITICAL NUMERIC RULE: Every single number you write MUST come verbatim from the provided "estimates", "robustness", "mcpSpans", or "literatureEstimates" objects. If "estimates" is empty, DO NOT write any numbers—state clearly that live data was unavailable.
State the honesty label (e.g. Quasi-experimental (Event Study), Associational, Descriptive) and confidence band explicitly.
Format brief with (## Executive Summary, ## Econometric Findings & Honesty Labels, ## Distributional Incidence) and appendix with (## Identification & Pre-Registration, ## Robustness Curve & What Would Change My Mind).`,
        JSON.stringify({
          title: scopeOut.runTitle,
          question: input.question,
          mcpSpans: mcpSpanDigest,
          estimates: estimateDigest,
          robustness: robustnessDigest,
          literatureEstimates: mcpResult.literatureEstimates,
          dataErrors: mcpResult.dataErrors,
          nodes: nodeList.map((node) => ({
            key: shortNodeKey(node.id),
            id: node.id,
            kind: node.kind,
            title: node.title,
            body: node.body,
            status: node.status,
            honestyLabel: node.honestyLabel,
          })),
        }),
      ).catch((error) => {
        console.error(
          "[polinote/crew] synthesizer json failed, using node-ID fallback",
          error instanceof Error
            ? redactSecrets(error.message)
            : "synthesizer error",
        );
        return null;
      })
    : Promise.resolve(null);

  const [written, rawSynth] = await Promise.all([analysesTask, synthTask]);

  for (const raw of graphOut.nodes) {
    const hit = written.get(raw.key) ?? written.get(slugKey(raw.key));
    if (!hit) continue;
    const auditedNodeBody = auditGeneratedProseNumbers(hit.body, numericRegistry, {
      stripUntraced: true,
    });
    raw.analysisTitle = hit.title;
    raw.analysis = auditedNodeBody.sanitizedText;
    yield { type: "analysis", analysis: hydrateAnalysis(input.runId, raw, web) };
  }

  let auditSummaryText = "Data Auditor: 0 untraced numbers.";
  if (rawSynth) {
    const parsed = asRecord(rawSynth);
    const rawBrief = normalizeNodeCitations(asString(parsed.brief, ""), nodeList);
    const rawAppendix = normalizeNodeCitations(
      asString(parsed.appendix, ""),
      nodeList,
    );
    const briefAudit = auditGeneratedProseNumbers(rawBrief, numericRegistry, {
      stripUntraced: true,
    });
    const appendixAudit = auditGeneratedProseNumbers(
      rawAppendix,
      numericRegistry,
      { stripUntraced: true },
    );

    const totalChecked =
      briefAudit.totalNumbersChecked + appendixAudit.totalNumbersChecked;
    const totalMatched = briefAudit.matchedCount + appendixAudit.matchedCount;
    const totalUntraced =
      briefAudit.untracedNumbers.length + appendixAudit.untracedNumbers.length;

    auditSummaryText = `Deterministic Data Auditor checked ${totalChecked} numeric token(s): ${totalMatched} traced to live series/estimates, ${totalUntraced} untraced (${totalUntraced > 0 ? "stripped before publish" : "0 mismatches"}).`;

    if (
      briefAudit.sanitizedText &&
      draftCitesNodes(
        `${briefAudit.sanitizedText}\n${appendixAudit.sanitizedText}`,
        nodeList,
      )
    ) {
      draft = {
        brief: briefAudit.sanitizedText,
        appendix: `${appendixAudit.sanitizedText}\n\n---\n*${auditSummaryText}*`,
        updatedAt: nowIso(),
      };
    }
  }

  yield {
    type: "narration",
    item: {
      id: crypto.randomUUID(),
      kind: "narration",
      agent: "data_auditor",
      text: auditSummaryText,
    },
  };

  yield {
    type: "narration",
    item: {
      id: crypto.randomUUID(),
      kind: "narration",
      agent: "synthesizer",
      text: `${draft.brief.split("\n\n").slice(0, 2).join("\n\n")}\n\nFull econometric tables, specification curve, and reproducible Jupyter/Quarto notebooks are ready on the Report & Export desk.`,
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
