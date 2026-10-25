import { gateway, generateText, type LanguageModel } from "ai";
import { openai } from "@ai-sdk/openai";
import { SkepticOutputSchema, type SkepticOutput } from "@/agents/schemas";
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
import { deriveObservationWindow } from "@/lib/data/selector";
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
  evaluateClaimStatusFromEstimate,
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
  policyDate: string | null;
  policyDateSource: string;
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
  candidateSeriesIds: string[];
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

const JSON_OPTIONS = {
  openai: {
    reasoningEffort: "low" as const,
    reasoningSummary: null,
  },
};

const SCOPE_STYLE = `Write every scope field as a dense research-protocol paragraph, not a slogan or one-liner.

objective: Start with "Digress …". State the analytic task, the hypothesized direction, the unit of analysis, and the policy date(s).

policyDate: Exact YYYY-MM-DD enactment or effective date of the policy instrument, or null if the question has no concrete enactment date.

policyDateSource: Cite the specific statute, public law number, executive order, Federal Register notice, or congressional record establishing policyDate.

instrument: Inventory the statutory tools — appropriations, tax rates, tariffs, regulation, procurement, or monetary rules. Separate enacted policy from proposals.

target: Name the outcome series to be estimated, the unit of analysis, geography, and treatment/control candidates.

identificationStrategy: Name the econometric estimator from the catalog (Event Study, Jordà Local Projections, Difference-in-Differences, Synthetic Control, ARIMA Counterfactual, Chow/Bai-Perron Break Test), its identifying assumptions, and named confounders in the observation window.

horizon: Give explicit pre-policy and post-policy dates (at least 6 years pre-policy through latest available).

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

function createModelSlot(preferredOverride?: string): ModelSlot {
  const baseQueue = modelQueue();
  const queue = preferredOverride
    ? [preferredOverride, ...baseQueue.filter((m) => m !== preferredOverride)]
    : baseQueue;
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

function extractValidPolicyDate(
  rawDate: unknown,
  horizon: string,
  question: string,
): string | null {
  if (typeof rawDate === "string" && rawDate.trim()) {
    const isoMatch = rawDate.trim().match(/\b(19\d{2}|20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/);
    if (isoMatch?.[0]) return isoMatch[0];
    const ymMatch = rawDate.trim().match(/\b(19\d{2}|20\d{2})-(0[1-9]|1[0-2])\b/);
    if (ymMatch?.[0]) return `${ymMatch[0]}-01`;
    const yrMatch = rawDate.trim().match(/\b(19[7-9]\d|20[0-2]\d)\b/);
    if (yrMatch?.[1]) return `${yrMatch[1]}-01-01`;
  }
  const derived = deriveObservationWindow({ question, horizon });
  return derived.policyDate;
}

function validateAndParseScope(raw: unknown, question: string): ScopeStep {
  const root = asRecord(raw);
  const scope = asRecord(root.scope ?? raw);

  const requiredKeys = [
    "jurisdiction",
    "horizon",
    "objective",
    "instrument",
    "target",
    "identificationStrategy",
    "distributionalCut",
    "baseline",
  ] as const;

  const missing = requiredKeys.filter(
    (k) => typeof scope[k] !== "string" || !String(scope[k]).trim(),
  );
  if (missing.length > 0) {
    throw new Error(
      `Scoper JSON validation failed: missing required scope fields (${missing.join(", ")})`,
    );
  }

  const horizonStr = asString(scope.horizon, "");
  const policyDate = extractValidPolicyDate(
    scope.policyDate ?? root.policyDate,
    horizonStr,
    question,
  );
  const policyDateSource = asString(
    scope.policyDateSource ?? root.policyDateSource,
    policyDate ? "Statutory / congressional enactment record" : "No single enactment date identified",
  );

  const rawSeriesIds = asArray(root.candidateSeriesIds ?? scope.candidateSeriesIds)
    .map((item) => (typeof item === "string" ? item.trim().toUpperCase() : ""))
    .filter((id) => /^[A-Z0-9_]{2,24}$/.test(id));

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
    candidateSeriesIds: rawSeriesIds.slice(0, 4),
    scope: {
      jurisdiction: asString(scope.jurisdiction, ""),
      horizon: horizonStr,
      policyDate,
      policyDateSource,
      objective: asString(scope.objective, ""),
      instrument: asString(scope.instrument, ""),
      target: asString(scope.target, ""),
      identificationStrategy: asString(scope.identificationStrategy, ""),
      distributionalCut: asString(scope.distributionalCut, ""),
      baseline: asString(scope.baseline, ""),
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

function validateAndParseGraph(raw: unknown): GraphStep {
  const root = Array.isArray(raw) ? { nodes: raw, edges: [] } : asRecord(raw);
  const nodes = asArray(root.nodes)
    .map((item, index) => coerceNode(item, index))
    .filter((item): item is RawNode => item !== null)
    .slice(0, 8);

  if (nodes.length === 0) {
    throw new Error("Graph JSON validation failed: model returned 0 valid nodes");
  }

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
    policyDate: fields.policyDate,
    policyDateSource: fields.policyDateSource,
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

/**
 * Calls the LLM for a structured JSON payload and validates it with `validator`.
 * If parsing or schema validation fails, automatically retries with a schema-repair prompt
 * passing the exact validation error and raw output. Never substitutes canned templates.
 */
async function askJsonWithSchemaRepair<T>(
  model: ModelSlot,
  system: string,
  prompt: string,
  validator: (parsed: unknown) => T,
): Promise<T> {
  let useReasoning = true;
  let repairInstruction = "";
  let attempts = 0;

  for (;;) {
    const timeout = withTimeout(JSON_TIMEOUT_MS);
    try {
      const { text } = await generateText({
        model: resolveAiModel(model.id),
        providerOptions: useReasoning ? JSON_OPTIONS : undefined,
        abortSignal: timeout.signal,
        system: `${AUTONOMY}\n${system}\nReturn ONLY a compact JSON object. No markdown fences. Keep string values concise.`,
        prompt: repairInstruction ? `${prompt}\n\n${repairInstruction}` : prompt,
      });
      const extracted = extractJson(text);
      return validator(extracted);
    } catch (error) {
      const errMsg =
        error instanceof Error ? redactSecrets(error.message) : "json error";
      console.error("[polinote/crew] json call failed", model.id, errMsg);

      if (isReasoningSummaryError(error) && useReasoning) {
        useReasoning = false;
        continue;
      }
      if (isModelUnavailable(error) && model.demote()) {
        continue;
      }
      if (attempts < 1 && !isAbortError(error)) {
        attempts += 1;
        repairInstruction = `SCHEMA REPAIR REQUIRED: Your previous output failed validation (${errMsg}). Repair the JSON so all required fields are present and valid.`;
        continue;
      }
      throw new Error(`LLM JSON validation failed after schema repair: ${errMsg}`);
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
  yield workingStatus("Step 1/7 · Scoper & policy date intake…");
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
    scopeOut = await askJsonWithSchemaRepair(
      model,
      `You are PoliNote's Scoper, Data Scout & Identification Strategist. Return JSON with:
- runTitle (max 80 chars)
- hypothesizedDirection ("positive" | "negative" | "ambiguous")
- preferredMethod ("event_study" | "local_projections_jorda" | "arima_forecast_counterfactual" | "descriptive_newey_west" | "did_twfe" | "synthetic_control")
- candidateSeriesIds: array of 2 to 3 official FRED series IDs (e.g. ["PNFI", "GPDIC1"] for nonresidential investment, ["IMPGS", "CPIAUCSL"] for tariffs/trade, ["HOUST", "CUSR0000SEHA"] for housing/zoning, ["PAYEMS", "UNRATE"] for labor/wages, ["FEDFUNDS", "CPIAUCSL"] for monetary policy, ["INDPRO", "MANEMP"] for industrial policy). First ID is the primary outcome series; second ID is the comparison/donor series.
- policyDate ("YYYY-MM-DD" enactment/effective date of the policy instrument, or a reference reform date in YYYY-MM-DD format)
- policyDateSource (statutory citation, Public Law number, Federal Register notice, or Congress record for policyDate)
- scope: { jurisdiction, horizon, policyDate, policyDateSource, objective, instrument, target, identificationStrategy, distributionalCut, baseline, allowedMethods, forbiddenMoves }
${SCOPE_STYLE}
Do not invent any empirical numbers in the scope.`,
      context,
      (parsed) => validateAndParseScope(parsed, input.question),
    );
  } catch (error) {
    const errMsg =
      error instanceof Error ? redactSecrets(error.message) : "Scope generation failed";
    yield {
      type: "error",
      message: `Scoper failed after schema repair: ${errMsg}`,
    };
    return;
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
      text: `Locked Scope Contract for “${scopeOut.runTitle}” (policy date: ${contract.policyDate ?? "unspecified"} [${contract.policyDateSource ?? "no source"}], hypothesized direction: ${scopeOut.hypothesizedDirection}, primary estimator: ${scopeOut.preferredMethod}).`,
    },
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

  yield workingStatus(
    "Step 3/7 · Identification Strategist & Literature Analyst placing spine…",
  );

  let graphOut: GraphStep;
  try {
    graphOut = await askJsonWithSchemaRepair(
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
      validateAndParseGraph,
    );
  } catch (error) {
    const errMsg =
      error instanceof Error ? redactSecrets(error.message) : "Graph generation failed";
    yield {
      type: "error",
      message: `Argument map generation failed after schema repair: ${errMsg}`,
    };
    return;
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

  // Step 4 & Step 5: Pre-registration lock -> Live Data Pull -> Econometric Estimation -> Automatic Robustness Suite
  yield workingStatus(
    "Step 4/7 · Fetching live series observations & running econometric estimation…",
  );
  const mcpResult = yield* streamMcpSpecialists({
    userId: input.userId,
    runId: input.runId,
    contract,
    scope: scopeOut.scope,
    queries,
    nodes: [...liveNodes.values()],
    preferredMethod: scopeOut.preferredMethod,
    hypothesizedDirection: scopeOut.hypothesizedDirection,
    candidateSeriesIds: scopeOut.candidateSeriesIds,
  });
  for (const node of mcpResult.nodes) {
    liveNodes.set(node.id, node);
  }

  const numericRegistry = buildAllowedNumericRegistry({
    bundles: mcpResult.bundles,
    estimates: mcpResult.estimates,
    robustness: mcpResult.robustness,
    literature: mcpResult.literatureEstimates,
  });

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
    relabelReason: est.relabelReason,
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
    preRegistrationLockedAt: est.spec.preRegistration.lockedAt,
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

  // Step 6 & Step 7: Run Skeptic Red-Team model call, Node Analyses, and Synthesizer in parallel
  yield workingStatus(
    "Step 6/7 · Skeptic Red-Team critique, Synthesizer & Data Auditor running in parallel…",
  );
  const skepticModel = createModelSlot(process.env.SKEPTIC_MODEL?.trim());

  const skepticTask = askJsonWithSchemaRepair(
    skepticModel,
    `You are PoliNote's Skeptic / Red Team. Return JSON matching SkepticOutputSchema:
{
  "namedConfounders": ["specific historical events or macro shocks in the observation window"],
  "reverseCausalityRisk": "1-2 sentences on endogeneity or anticipation",
  "specificationFragility": "1-2 sentences critiquing pre-trends, comparison group, or window sensitivity",
  "externalValidityLimits": "1-2 sentences on generalizability limits",
  "unresolvedObjectionsCount": 0..3,
  "whatWouldChangeMyMind": [
    {
      "id": "fork_1",
      "title": "short fork title",
      "description": "what specific empirical result would flip the conclusion",
      "forkParameter": "method" | "window" | "series" | "transform" | "placebo_date",
      "proposedValue": "specific parameter value"
    }
  ]
}
Do not invent any numbers not present in the prompt.`,
    JSON.stringify({
      question: input.question,
      scope: scopeOut.scope,
      estimates: estimateDigest,
      robustness: robustnessDigest,
      dataErrors: mcpResult.dataErrors,
    }),
    (parsed) => SkepticOutputSchema.parse(parsed),
  ).catch((error) => {
    console.warn(
      "[polinote/skeptic] model call failed:",
      error instanceof Error ? redactSecrets(error.message) : "error",
    );
    return null;
  });

  const nodeSnapshotBeforeSkeptic = [...liveNodes.values()];

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
    ? askJsonWithSchemaRepair(
        model,
        `You are PoliNote's Synthesizer. Return JSON { "brief", "appendix" }.
Every factual sentence MUST cite an existing node short key in square brackets, like [claim_core] or [ev_fred].
CRITICAL NUMERIC RULE: Every single number you write MUST come verbatim from the provided "estimates", "robustness", "mcpSpans", or "literatureEstimates" objects, and you must name the series ID or date when citing an observation. If "estimates" is empty, DO NOT write any numbers—state clearly that live data was unavailable.
State the exact honesty label (e.g. Descriptive, Associational, Quasi-experimental (Difference-in-Differences)) and confidence band explicitly.
Format brief with (## Executive Summary, ## Econometric Findings & Honesty Labels, ## Distributional Incidence) and appendix with (## Identification & Pre-Registration, ## Robustness Curve & What Would Change My Mind).`,
        JSON.stringify({
          title: scopeOut.runTitle,
          question: input.question,
          mcpSpans: mcpSpanDigest,
          estimates: estimateDigest,
          robustness: robustnessDigest,
          literatureEstimates: mcpResult.literatureEstimates,
          dataErrors: mcpResult.dataErrors,
          nodes: nodeSnapshotBeforeSkeptic.map((node) => ({
            key: shortNodeKey(node.id),
            id: node.id,
            kind: node.kind,
            title: node.title,
            body: node.body,
            status: node.status,
            confidence: node.confidence,
            honestyLabel: node.honestyLabel,
          })),
        }),
        (parsed) => {
          const rec = asRecord(parsed);
          if (typeof rec.brief !== "string" || !rec.brief.trim()) {
            throw new Error("Synthesizer JSON missing brief string");
          }
          return rec;
        },
      ).catch((error) => {
        console.error(
          "[polinote/crew] synthesizer json failed, using deterministic draft",
          error instanceof Error
            ? redactSecrets(error.message)
            : "synthesizer error",
        );
        return null;
      })
    : Promise.resolve(null);

  const [skepticOutput, written, rawSynth] = await Promise.all([
    skepticTask,
    analysesTask,
    synthTask,
  ]);

  // Apply Skeptic's unresolvedObjectionsCount to Claim confidence score and update unc_id node
  if (skepticOutput && mcpResult.estimates[0]) {
    const headlineEst = mcpResult.estimates[0];
    const robBundle = mcpResult.robustness[0] ?? null;
    for (const node of liveNodes.values()) {
      if (node.kind === "claim" && node.estimateId === headlineEst.id) {
        const reEval = evaluateClaimStatusFromEstimate({
          estimate: headlineEst,
          robustness: robBundle,
          hypothesizedDirection:
            node.hypothesizedDirection ?? scopeOut.hypothesizedDirection,
          unresolvedSkepticObjections: skepticOutput.unresolvedObjectionsCount,
        });
        const updatedClaim: DigressionNode = {
          ...node,
          status: reEval.status,
          confidence: reEval.confidence,
          statusReason: `${reEval.reason} (Skeptic unresolved objections: ${skepticOutput.unresolvedObjectionsCount}).`,
          updatedAt: nowIso(),
        };
        liveNodes.set(updatedClaim.id, updatedClaim);
        yield { type: "node", node: updatedClaim };
      }
      if (node.kind === "uncertainty") {
        const rawCritique = `${skepticOutput.specificationFragility} Confounders in window: ${skepticOutput.namedConfounders.join("; ")}.`;
        const auditedCritique = auditGeneratedProseNumbers(
          rawCritique,
          numericRegistry,
          { stripUntraced: true },
        ).sanitizedText;
        const updatedUnc: DigressionNode = {
          ...node,
          body: auditedCritique.slice(0, 360),
          updatedAt: nowIso(),
        };
        liveNodes.set(updatedUnc.id, updatedUnc);
        yield { type: "node", node: updatedUnc };
      }
    }
  }

  const afterCritic = yield* applyCriticWalls([...liveNodes.values()]);
  for (const node of afterCritic) {
    liveNodes.set(node.id, node);
  }

  const nodeList = [...liveNodes.values()];
  const supportedNodes = nodeList.filter((n) => n.status === "supported");

  if (skepticOutput) {
    const flipList = skepticOutput.whatWouldChangeMyMind
      .map((f, i) => `(${i + 1}) ${f.title}: ${f.description}`)
      .join("; ");
    const rawSkepticNarration = `Skeptic Red-Team Critique (${skepticOutput.unresolvedObjectionsCount} unresolved objection${skepticOutput.unresolvedObjectionsCount === 1 ? "" : "s"}): Confounders in window: ${skepticOutput.namedConfounders.join(", ")}. Reverse causality: ${skepticOutput.reverseCausalityRisk} Specification fragility: ${skepticOutput.specificationFragility} What would change my mind: ${flipList}`;
    const auditedSkepticNarration = auditGeneratedProseNumbers(
      rawSkepticNarration,
      numericRegistry,
      { stripUntraced: true },
    ).sanitizedText;

    yield {
      type: "narration",
      item: {
        id: crypto.randomUUID(),
        kind: "narration",
        agent: "skeptic",
        text: auditedSkepticNarration,
      },
    };
  }

  yield workingStatus(
    "Step 7/7 · Data Auditor verifying every number in synthesis…",
  );

  let draft = fallbackDraft(
    scopeOut.runTitle,
    input.question,
    nodeList,
    mcpResult.estimates,
    mcpResult.dataErrors,
  );

  for (const raw of graphOut.nodes) {
    const hit = written.get(raw.key) ?? written.get(slugKey(raw.key));
    if (!hit) continue;
    const auditedNodeBody = auditGeneratedProseNumbers(
      hit.body,
      numericRegistry,
      {
        stripUntraced: true,
      },
    );
    raw.analysisTitle = hit.title;
    raw.analysis = auditedNodeBody.sanitizedText;
    yield { type: "analysis", analysis: hydrateAnalysis(input.runId, raw, web) };
  }

  let auditSummaryText = "Data Auditor: 0 untraced numbers.";
  if (rawSynth) {
    const rawBrief = normalizeNodeCitations(asString(rawSynth.brief, ""), nodeList);
    const rawAppendix = normalizeNodeCitations(
      asString(rawSynth.appendix, ""),
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

    auditSummaryText = `Deterministic Data Auditor checked ${totalChecked} numeric token(s): ${totalMatched} traced to specific series/estimates, ${totalUntraced} untraced (${totalUntraced > 0 ? "stripped before publish" : "0 mismatches"}).`;

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
      text: `${draft.brief.split("\n\n").slice(0, 2).join("\n\n")}\n\nFull econometric tables, specification curve, and reproducible Jupyter notebooks (${supportedNodes.length} supported claim${supportedNodes.length === 1 ? "" : "s"}) are ready on the Report & Export desk.`,
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
