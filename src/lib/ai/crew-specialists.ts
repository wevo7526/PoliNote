import { allowRoleAction } from "@/agents/walls";
import type { CrewRole } from "@/agents/roles";
import type { CrewStreamEvent } from "@/lib/ai/crew-events";
import { workingStatus } from "@/lib/ai/crew-events";
import { ensureMcpTools } from "@/lib/mcp/register";
import { serverForTool } from "@/lib/mcp/catalog";
import type { RunDraft } from "@/lib/platform-types";
import {
  canMarkSupported,
  type DigressionEdge,
  type DigressionNode,
  type ProvenanceChip,
} from "@/schemas/digression";
import type { NodeAnalysis } from "@/schemas/analysis";
import type { AllowedMethod, ScopeContract } from "@/schemas/scope-contract";
import type { EvidenceSpan } from "@/schemas/span";
import { callTool, type ToolName } from "@/tools/registry";

export type SpecialistQueries = {
  fred: string;
  lit: string;
  policy: string;
  macro: string;
};

type ScopeBits = {
  instrument: string;
  target: string;
  jurisdiction: string;
  distributionalCut: string;
  allowedMethods: AllowedMethod[];
};

function nowIso(): string {
  return new Date().toISOString();
}

function slugKey(key: string): string {
  return key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 32);
}

function seedQuery(text: string, extra = "", max = 72): string {
  const words = text
    .replace(/[?!.,;:()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word.length > 2)
    .slice(0, 10);
  return `${words.join(" ")} ${extra}`.trim().slice(0, max);
}

export function deriveQueries(question: string, _scope: ScopeBits): SpecialistQueries {
  const seed = question.trim().length >= 12 ? question : _scope.instrument;
  return {
    fred: seedQuery(seed, "price production employment"),
    lit: seedQuery(seed, "economics"),
    policy: seedQuery(seed),
    macro: "united states consumer price index unemployment",
  };
}

function publicToolError(error: string): string {
  return error.replace(/api[_-]?key=[^&\s]+/gi, "api_key=redacted");
}

function asSpan(value: unknown): EvidenceSpan | null {
  if (!value || typeof value !== "object") return null;
  const span = value as EvidenceSpan;
  if (!span.id || !span.server || !span.tool || !span.citation || !span.resultHash) {
    return null;
  }
  return span;
}

function mcpEvent(
  agent: CrewRole,
  tool: ToolName,
  ok: boolean,
  label: string,
  spanId?: string,
): CrewStreamEvent {
  return {
    type: "mcp",
    agent,
    server: serverForTool(tool) ?? "workspace",
    tool,
    ok,
    label,
    spanId,
  };
}

async function invoke(
  agent: CrewRole,
  tool: ToolName,
  args: Record<string, unknown>,
): Promise<{ event: CrewStreamEvent; span: EvidenceSpan | null; data: unknown }> {
  ensureMcpTools();
  try {
    const result = await callTool(tool, args);
    const data =
      result.data && typeof result.data === "object"
        ? (result.data as Record<string, unknown>)
        : {};
    const span = asSpan(data.span) ?? null;
    const label = result.ok
      ? (span?.citation ?? `${tool} ok`)
      : publicToolError(result.error ?? `${tool} failed`);
    return {
      event: mcpEvent(agent, tool, result.ok, label, result.spanId ?? span?.id),
      span: result.ok ? span : null,
      data: result.ok ? result.data : null,
    };
  } catch (error) {
    const message = publicToolError(
      error instanceof Error ? error.message : `${tool} failed`,
    );
    return {
      event: mcpEvent(agent, tool, false, message),
      span: null,
      data: null,
    };
  }
}

function attachSpan(
  role: CrewRole,
  node: DigressionNode,
  span: EvidenceSpan,
): DigressionNode | null {
  if (!allowRoleAction(role, { type: "attach_span" })) return null;
  const ids = node.evidenceSpanIds.includes(span.id)
    ? node.evidenceSpanIds
    : [...node.evidenceSpanIds, span.id];
  const chip: ProvenanceChip = {
    source: span.server,
    label: span.citation,
    spanId: span.id,
    url: span.url,
  };
  const provenance = [
    ...node.provenance.filter((item) => item.spanId !== span.id),
    chip,
  ];
  let status = node.status;
  if (
    canMarkSupported({ evidenceSpanIds: ids }) &&
    allowRoleAction(role, { type: "mark_supported" })
  ) {
    status = "supported";
  }
  return {
    ...node,
    evidenceSpanIds: ids,
    provenance,
    status,
    agent: role,
    updatedAt: nowIso(),
  };
}

function makeNode(
  role: CrewRole,
  runId: string,
  key: string,
  kind: DigressionNode["kind"],
  title: string,
  body: string,
): DigressionNode | null {
  if (!allowRoleAction(role, { type: "add_node", kind })) return null;
  const ts = nowIso();
  return {
    id: `${runId}_${slugKey(key)}`,
    runId,
    kind,
    status: "proposed",
    title,
    body,
    confidence: "medium",
    agent: role,
    provenance: [],
    position: { x: 0, y: 0 },
    evidenceSpanIds: [],
    createdAt: ts,
    updatedAt: ts,
  };
}

function makeEdge(
  runId: string,
  sourceId: string,
  targetId: string,
  kind: DigressionEdge["kind"],
): DigressionEdge {
  return {
    id: `${runId}_e_${slugKey(sourceId)}_${slugKey(targetId)}_${kind}`.slice(0, 80),
    runId,
    sourceId,
    targetId,
    kind,
    createdAt: nowIso(),
  };
}

function makeAnalysis(node: DigressionNode, span: EvidenceSpan | null): NodeAnalysis {
  const body = [
    "## Mechanism",
    node.body,
    "",
    "## Incidence",
    "This node is an evidence attachment, not an incidence estimate.",
    "",
    "## Identification",
    span
      ? `Backed by MCP span ${span.id} (${span.tool}).`
      : "No MCP span yet.",
    "",
    "## Sign flip",
    "The reading can flip if the series, statute, or paper is the wrong object.",
    "",
    "## Missing evidence",
    span ? "Span attached. Critic may still contest identification." : "Needs an MCP span.",
  ].join("\n");
  return {
    nodeId: node.id,
    runId: node.runId,
    title: node.title,
    body,
    citations: span
      ? [{ title: span.citation, url: span.url, note: span.id }]
      : [],
  };
}

function findByKey(nodes: DigressionNode[], runId: string, key: string): DigressionNode | undefined {
  const id = `${runId}_${slugKey(key)}`;
  return nodes.find((node) => node.id === id);
}

function firstOfKind(nodes: DigressionNode[], kind: DigressionNode["kind"]): DigressionNode | undefined {
  return nodes.find((node) => node.kind === kind);
}

function upsertNode(nodes: DigressionNode[], next: DigressionNode): DigressionNode[] {
  return nodes.some((node) => node.id === next.id)
    ? nodes.map((node) => (node.id === next.id ? next : node))
    : [...nodes, next];
}

export async function* streamInstrumentParser(input: {
  userId: string;
  runId: string;
  question: string;
  scope: ScopeBits;
}): AsyncGenerator<CrewStreamEvent, SpecialistQueries> {
  const queries = deriveQueries(input.question, input.scope);
  yield workingStatus(
    `Instrument parser locking queries — FRED “${queries.fred}”, literature, policy docs…`,
  );
  const memo = [
    `question: ${input.question}`,
    `fred: ${queries.fred}`,
    `lit: ${queries.lit}`,
    `policy: ${queries.policy}`,
    `macro: ${queries.macro}`,
  ].join("\n");
  const written = await invoke("instrument_parser", "workspace.write_memo", {
    userId: input.userId,
    runId: input.runId,
    body: memo,
  });
  yield written.event;
  yield {
    type: "narration",
    item: {
      id: crypto.randomUUID(),
      kind: "narration",
      agent: "instrument_parser",
      text: [
        `FRED query: ${queries.fred}.`,
        `Literature query: ${queries.lit}.`,
        `Policy-docs query: ${queries.policy}.`,
        "Those queries are in the workspace memo. Nodes stay proposed until a specialist attaches a span.",
      ].join("\n\n"),
    },
  };
  return queries;
}

export async function* streamMcpSpecialists(input: {
  userId: string;
  runId: string;
  contract: ScopeContract;
  scope: ScopeBits;
  queries: SpecialistQueries;
  nodes: DigressionNode[];
}): AsyncGenerator<CrewStreamEvent, DigressionNode[]> {
  const allow = input.contract.mcpAllowlist;
  const methods = new Set(input.scope.allowedMethods);
  let nodes = input.nodes.slice();
  const claim = firstOfKind(nodes, "claim") ?? nodes[0];
  const mechanism = firstOfKind(nodes, "mechanism");
  const constraint = firstOfKind(nodes, "constraint");

  type Invoked = {
    role: CrewRole;
    tool: ToolName;
    event: CrewStreamEvent;
    span: EvidenceSpan | null;
    data: unknown;
  };
  const jobs: Array<Promise<Invoked>> = [];

  const queue = (
    role: CrewRole,
    tool: ToolName,
    args: Record<string, unknown>,
  ) => {
    jobs.push(
      invoke(role, tool, args).then((result) => ({
        role,
        tool,
        event: result.event,
        span: result.span,
        data: result.data,
      })),
    );
  };

  if (allow["econ-series"] && (methods.has("time_series") || methods.has("macro"))) {
    yield workingStatus("Series is querying FRED…");
    queue("series", "econ.search_series", { query: input.queries.fred });
  }
  if (allow.literature && methods.has("literature")) {
    yield workingStatus("Literature is searching OpenAlex…");
    queue("literature", "lit.search", { query: input.queries.lit });
  }
  if (allow["policy-docs"] && methods.has("legal_text")) {
    yield workingStatus("Legal is searching official policy documents…");
    queue("legal", "policy.search", { query: input.queries.policy });
  }
  if (allow["econ-series"] && methods.has("macro")) {
    queue("macro", "econ.search_series", { query: input.queries.macro });
  }

  const settled = await Promise.all(jobs);
  for (const result of settled) {
    yield result.event;
  }

  const seriesSearch = settled.find(
    (item) => item.role === "series" && item.tool === "econ.search_series",
  );
  const seriesId =
    seriesSearch &&
    seriesSearch.data &&
    typeof seriesSearch.data === "object" &&
    Array.isArray((seriesSearch.data as { series?: Array<{ id?: string }> }).series)
      ? (seriesSearch.data as { series: Array<{ id?: string }> }).series[0]?.id
      : undefined;

  if (seriesId) {
    const obs = await invoke("series", "econ.get_observations", { seriesId });
    yield obs.event;
    if (obs.span) {
      const existing = findByKey(nodes, input.runId, "ev_fred");
      let node =
        existing ??
        makeNode(
          "series",
          input.runId,
          "ev_fred",
          "evidence",
          `FRED ${seriesId}`,
          obs.span.citation,
        );
      if (node) {
        const attached = attachSpan("series", node, obs.span);
        if (attached) {
          node = attached;
          nodes = upsertNode(nodes, node);
          yield { type: "node", node };
          yield { type: "analysis", analysis: makeAnalysis(node, obs.span) };
          if (claim && claim.id !== node.id) {
            yield { type: "edge", edge: makeEdge(input.runId, node.id, claim.id, "supports") };
          }
        }
      }
    }
  }

  const lit = settled.find((item) => item.tool === "lit.search");
  if (lit?.span) {
    const works =
      lit.data && typeof lit.data === "object"
        ? ((lit.data as { works?: Array<{ title?: string }> }).works ?? [])
        : [];
    if (works.length > 0) {
      const existing = findByKey(nodes, input.runId, "ev_openalex");
      let node =
        existing ??
        makeNode(
          "literature",
          input.runId,
          "ev_openalex",
          "evidence",
          works[0]?.title?.slice(0, 80) || "OpenAlex work",
          lit.span.citation,
        );
      if (node) {
        const attached = attachSpan("literature", node, lit.span);
        if (attached) {
          node = attached;
          nodes = upsertNode(nodes, node);
          yield { type: "node", node };
          yield { type: "analysis", analysis: makeAnalysis(node, lit.span) };
          const target = mechanism ?? claim;
          if (target && target.id !== node.id) {
            yield {
              type: "edge",
              edge: makeEdge(input.runId, node.id, target.id, "supports"),
            };
          }
        }
      }
    }
  }

  const policy = settled.find((item) => item.tool === "policy.search");
  if (policy?.span) {
    const docs =
      policy.data && typeof policy.data === "object"
        ? ((policy.data as { docs?: Array<{ title?: string; url?: string }> }).docs ?? [])
        : [];
    if (docs.some((doc) => doc.title)) {
      const existing =
        findByKey(nodes, input.runId, "ev_policy") ?? constraint;
      let node =
        existing ??
        makeNode(
          "legal",
          input.runId,
          "ev_policy",
          "constraint",
          docs[0]?.title?.slice(0, 80) || "Policy document",
          policy.span.citation,
        );
      if (node) {
        const attached = attachSpan("legal", { ...node, body: policy.span.citation }, policy.span);
        if (attached) {
          node = attached;
          nodes = upsertNode(nodes, node);
          yield { type: "node", node };
          yield { type: "analysis", analysis: makeAnalysis(node, policy.span) };
          if (mechanism && mechanism.id !== node.id) {
            yield {
              type: "edge",
              edge: makeEdge(input.runId, node.id, mechanism.id, "depends_on"),
            };
          }
        }
      }
    }
  }

  const macro = settled.find((item) => item.role === "macro");
  const macroId =
    macro &&
    macro.data &&
    typeof macro.data === "object" &&
    Array.isArray((macro.data as { series?: Array<{ id?: string }> }).series)
      ? (macro.data as { series: Array<{ id?: string }> }).series[0]?.id
      : undefined;
  if (macroId && macroId !== seriesId) {
    const obs = await invoke("macro", "econ.get_observations", { seriesId: macroId });
    yield obs.event;
    if (obs.span) {
      const existing = findByKey(nodes, input.runId, "ev_macro");
      let node =
        existing ??
        makeNode(
          "macro",
          input.runId,
          "ev_macro",
          "evidence",
          `FRED ${macroId}`,
          obs.span.citation,
        );
      if (node) {
        const attached = attachSpan("macro", node, obs.span);
        if (attached) {
          node = attached;
          nodes = upsertNode(nodes, node);
          yield { type: "node", node };
          yield { type: "analysis", analysis: makeAnalysis(node, obs.span) };
          if (claim && claim.id !== node.id) {
            yield { type: "edge", edge: makeEdge(input.runId, node.id, claim.id, "elaborates") };
          }
        }
      }
    }
  }

  if (!firstOfKind(nodes, "incidence") && methods.has("incidence")) {
    const created = makeNode(
      "incidence",
      input.runId,
      "inc_winners",
      "incidence",
      "Incidence of the tradeoff",
      input.scope.distributionalCut.slice(0, 360),
    );
    if (created) {
      nodes = upsertNode(nodes, created);
      yield { type: "node", node: created };
      yield { type: "analysis", analysis: makeAnalysis(created, null) };
      if (claim) {
        yield { type: "edge", edge: makeEdge(input.runId, claim.id, created.id, "causal") };
      }
    }
  }

  return nodes;
}

export function* applyCriticWalls(
  nodes: DigressionNode[],
): Generator<CrewStreamEvent, DigressionNode[]> {
  const next: DigressionNode[] = [];
  for (const node of nodes) {
    let updated = node;
    if (updated.status === "supported" && !canMarkSupported(updated)) {
      if (allowRoleAction("critic", { type: "update_node", status: "proposed" })) {
        updated = { ...updated, status: "proposed", updatedAt: nowIso() };
      }
    }
    if (
      (updated.kind === "claim" || updated.kind === "mechanism") &&
      updated.evidenceSpanIds.length === 0 &&
      updated.status !== "rejected" &&
      updated.status !== "pruned"
    ) {
      if (allowRoleAction("critic", { type: "update_node", status: "contested" })) {
        updated = { ...updated, status: "contested", updatedAt: nowIso() };
      }
      if (allowRoleAction("critic", { type: "flag" })) {
        yield {
          type: "flag",
          nodeId: updated.id,
          message: `${updated.title} has no MCP span, so it stays contested.`,
        };
      }
    }
    if (updated !== node) {
      yield { type: "node", node: updated };
    }
    next.push(updated);
  }
  return next;
}

export function fallbackDraft(
  title: string,
  question: string,
  nodes: DigressionNode[],
): RunDraft {
  const lead = nodes.filter((node) => node.kind === "claim" || node.kind === "incidence");
  const rest = nodes.filter((node) => node.kind !== "claim" && node.kind !== "incidence");
  const lines = (lead.length > 0 ? lead : nodes).map(
    (node) =>
      `- ${node.title} [${node.id}] — ${node.body}${
        node.status === "supported" ? " (supported)" : ""
      }`,
  );
  return {
    brief: [`# ${title}`, "", question, "", "## Claims", "", ...lines].join("\n"),
    appendix: rest
      .map((node) => `### ${node.kind}: ${node.title}\n\n${node.body}\n\n[${node.id}]`)
      .join("\n\n"),
    updatedAt: nowIso(),
  };
}

export function draftCitesNodes(text: string, nodes: DigressionNode[]): boolean {
  return nodes.some((node) => text.includes(node.id));
}

export async function* streamTraceNarrator(input: {
  userId: string;
  runId: string;
  nodes: DigressionNode[];
}): AsyncGenerator<CrewStreamEvent> {
  const traced = await invoke("trace_narrator", "trace.get_run", {
    userId: input.userId,
    runId: input.runId,
  });
  yield traced.event;
  const supported = input.nodes.filter((node) => node.status === "supported").length;
  const spans = input.nodes.reduce((sum, node) => sum + node.evidenceSpanIds.length, 0);
  yield workingStatus(
    `Trace: ${spans} MCP span${spans === 1 ? "" : "s"}, ${supported} supported node${
      supported === 1 ? "" : "s"
    }.`,
  );
}
