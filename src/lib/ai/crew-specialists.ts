import { allowRoleAction } from "@/agents/walls";
import type { CrewRole } from "@/agents/roles";
import type { CrewStreamEvent } from "@/lib/ai/crew-events";
import { workingStatus } from "@/lib/ai/crew-events";
import {
  cleanFredSearchText,
  resolveCanonicalSeries,
  type FredSeries,
} from "@/lib/mcp/fred";
import { redactSecrets } from "@/lib/mcp/http";
import { ensureMcpTools } from "@/lib/mcp/register";
import { serverForTool } from "@/lib/mcp/catalog";
import type { RunDraft } from "@/lib/platform-types";
import { shortNodeKey } from "@/lib/ui/prose";
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

export function deriveQueries(question: string, scope: ScopeBits): SpecialistQueries {
  const combined = `${question} ${scope.instrument.slice(0, 160)} ${scope.target.slice(0, 120)}`;
  const canonical = resolveCanonicalSeries(combined);
  const primaryCanonical = canonical[0];
  const secondaryCanonical =
    canonical[1] ?? canonical.find((c) => c.id !== primaryCanonical?.id);

  return {
    fred: primaryCanonical
      ? `${primaryCanonical.title} (${primaryCanonical.id})`
      : cleanFredSearchText(combined),
    lit: seedQuery(question, "empirical economics identification", 80),
    policy: seedQuery(`${question} ${scope.jurisdiction.slice(0, 60)}`, "statute regulation", 80),
    macro: secondaryCanonical
      ? `${secondaryCanonical.title} (${secondaryCanonical.id})`
      : "Real Gross Domestic Product Unemployment CPI",
  };
}

function publicToolError(error: string): string {
  return redactSecrets(error);
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

export function attachSpan(
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
    seriesId: span.seriesId,
    seriesTitle: span.seriesTitle,
    units: span.units,
    seriesPoints: span.seriesPoints,
  };
  const provenance = [
    ...node.provenance.filter((item) => item.spanId !== span.id),
    chip,
  ];
  let status = node.status;
  if (
    status !== "pruned" &&
    status !== "rejected" &&
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
    confidence: status === "supported" && node.confidence === "unknown" ? "high" : node.confidence,
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
    confidence: "high",
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
  const pts = span?.seriesPoints ?? [];
  const latest = pts[pts.length - 1];
  const earliest = pts[0];
  const seriesSummary =
    pts.length >= 2 && latest && earliest
      ? `Observed across ${pts.length} periods (${earliest.date} = ${earliest.value} to ${latest.date} = ${latest.value}${span?.units ? ` ${span.units}` : ""}).`
      : "";

  const body = [
    "## Mechanism",
    `${node.body} ${seriesSummary}`.trim(),
    "",
    "## Incidence",
    "Empirical series benchmark used to anchor pass-through, output, and distributional splits on the policy spine.",
    "",
    "## Identification",
    span
      ? `Backed by verified MCP span ${span.id} (${span.tool} · ${span.citation}).`
      : "No MCP span yet.",
    "",
    "## Sign flip",
    "The empirical reading can flip if structural breaks, compositional shifts, or confounding macro shocks dominate the window.",
    "",
    "## Missing evidence",
    span
      ? "Empirical MCP span attached and hashed in the run record."
      : "Needs an allowlisted MCP span.",
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

function findByKey(
  nodes: DigressionNode[],
  runId: string,
  key: string,
): DigressionNode | undefined {
  const id = `${runId}_${slugKey(key)}`;
  return nodes.find((node) => node.id === id);
}

function firstOfKind(
  nodes: DigressionNode[],
  kind: DigressionNode["kind"],
): DigressionNode | undefined {
  return nodes.find((node) => node.kind === kind);
}

function upsertNode(
  nodes: DigressionNode[],
  next: DigressionNode,
): DigressionNode[] {
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
    `Instrument parser locking queries — FRED “${queries.fred}”, OpenAlex, policy docs…`,
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
      text: `Locked empirical queries in the workspace memo: FRED series (${queries.fred}; ${queries.macro}), OpenAlex literature (${queries.lit}), and statutory text (${queries.policy}).`,
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
}): AsyncGenerator<
  CrewStreamEvent,
  { nodes: DigressionNode[]; spans: EvidenceSpan[] }
> {
  const allow = input.contract.mcpAllowlist;
  const methods = new Set(input.scope.allowedMethods);
  let nodes = input.nodes.slice();
  const collectedSpans: EvidenceSpan[] = [];

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

  if (allow["econ-series"]) {
    yield workingStatus("Series & Macro specialists querying FRED…");
    queue("series", "econ.search_series", { query: input.queries.fred });
    queue("macro", "econ.search_series", { query: input.queries.macro });
  }
  if (allow.literature) {
    yield workingStatus("Literature is searching OpenAlex…");
    queue("literature", "lit.search", { query: input.queries.lit });
  }
  if (allow["policy-docs"]) {
    yield workingStatus("Legal is searching official policy documents…");
    queue("legal", "policy.search", { query: input.queries.policy });
  }

  const settled = await Promise.all(jobs);
  for (const result of settled) {
    yield result.event;
    if (result.span) collectedSpans.push(result.span);
  }

  const seriesSearch = settled.find(
    (item) => item.role === "series" && item.tool === "econ.search_series",
  );
  const seriesLead =
    seriesSearch &&
    seriesSearch.data &&
    typeof seriesSearch.data === "object" &&
    Array.isArray((seriesSearch.data as { series?: FredSeries[] }).series)
      ? (seriesSearch.data as { series: FredSeries[] }).series[0]
      : undefined;
  const seriesId = seriesLead?.id;

  if (seriesId) {
    const obs = await invoke("series", "econ.get_observations", {
      seriesId,
      title: seriesLead?.title,
      units: seriesLead?.units,
    });
    yield obs.event;
    if (obs.span) {
      collectedSpans.push(obs.span);
      const existing = findByKey(nodes, input.runId, "ev_fred");
      let node =
        existing ??
        makeNode(
          "series",
          input.runId,
          "ev_fred",
          "evidence",
          seriesLead?.title
            ? `${seriesId}: ${seriesLead.title.slice(0, 44)}`
            : `FRED ${seriesId}`,
          obs.span.citation,
        );
      if (node) {
        const attached = attachSpan("series", node, obs.span);
        if (attached) {
          node = attached;
          nodes = upsertNode(nodes, node);
          yield { type: "node", node };
          yield { type: "analysis", analysis: makeAnalysis(node, obs.span) };

          // Propagate FRED empirical span onto the primary Claim node so it graduates to supported
          const claimTarget = firstOfKind(nodes, "claim");
          if (claimTarget && claimTarget.id !== node.id) {
            yield {
              type: "edge",
              edge: makeEdge(input.runId, node.id, claimTarget.id, "supports"),
            };
            const promotedClaim = attachSpan("series", claimTarget, obs.span);
            if (promotedClaim) {
              nodes = upsertNode(nodes, promotedClaim);
              yield { type: "node", node: promotedClaim };
            }
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
          works[0]?.title?.slice(0, 68) || "OpenAlex empirical study",
          lit.span.citation,
        );
      if (node) {
        const attached = attachSpan("literature", node, lit.span);
        if (attached) {
          node = attached;
          nodes = upsertNode(nodes, node);
          yield { type: "node", node };
          yield { type: "analysis", analysis: makeAnalysis(node, lit.span) };

          // Propagate OpenAlex span onto the primary Mechanism node so it graduates to supported
          const mechTarget = firstOfKind(nodes, "mechanism") ?? firstOfKind(nodes, "claim");
          if (mechTarget && mechTarget.id !== node.id) {
            yield {
              type: "edge",
              edge: makeEdge(input.runId, node.id, mechTarget.id, "supports"),
            };
            const promotedMech = attachSpan("literature", mechTarget, lit.span);
            if (promotedMech) {
              nodes = upsertNode(nodes, promotedMech);
              yield { type: "node", node: promotedMech };
            }
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
      const constraintNode =
        firstOfKind(nodes, "constraint") ?? findByKey(nodes, input.runId, "ev_policy");
      let node =
        constraintNode ??
        makeNode(
          "legal",
          input.runId,
          "ev_policy",
          "constraint",
          docs[0]?.title?.slice(0, 68) || "Statutory / policy authority",
          policy.span.citation,
        );
      if (node) {
        const attached = attachSpan("legal", node, policy.span);
        if (attached) {
          node = attached;
          nodes = upsertNode(nodes, node);
          yield { type: "node", node };
          if (!constraintNode) {
            yield { type: "analysis", analysis: makeAnalysis(node, policy.span) };
          }
          const mechTarget = firstOfKind(nodes, "mechanism");
          if (mechTarget && mechTarget.id !== node.id) {
            yield {
              type: "edge",
              edge: makeEdge(input.runId, node.id, mechTarget.id, "depends_on"),
            };
          }
        }
      }
    }
  }

  const macro = settled.find((item) => item.role === "macro");
  const macroSeriesList =
    macro &&
    macro.data &&
    typeof macro.data === "object" &&
    Array.isArray((macro.data as { series?: FredSeries[] }).series)
      ? (macro.data as { series: FredSeries[] }).series
      : [];
  const macroLead =
    macroSeriesList.find((s) => s.id && s.id !== seriesId) ?? macroSeriesList[0];
  const macroId = macroLead?.id;

  if (macroId && macroId !== seriesId) {
    const obs = await invoke("macro", "econ.get_observations", {
      seriesId: macroId,
      title: macroLead?.title,
      units: macroLead?.units,
    });
    yield obs.event;
    if (obs.span) {
      collectedSpans.push(obs.span);
      const existing = findByKey(nodes, input.runId, "ev_macro");
      let node =
        existing ??
        makeNode(
          "macro",
          input.runId,
          "ev_macro",
          "evidence",
          macroLead?.title
            ? `${macroId}: ${macroLead.title.slice(0, 44)}`
            : `FRED ${macroId}`,
          obs.span.citation,
        );
      if (node) {
        const attached = attachSpan("macro", node, obs.span);
        if (attached) {
          node = attached;
          nodes = upsertNode(nodes, node);
          yield { type: "node", node };
          yield { type: "analysis", analysis: makeAnalysis(node, obs.span) };

          // Propagate macro span to Incidence node if present
          const incTarget = firstOfKind(nodes, "incidence") ?? firstOfKind(nodes, "claim");
          if (incTarget && incTarget.id !== node.id) {
            yield {
              type: "edge",
              edge: makeEdge(input.runId, node.id, incTarget.id, "elaborates"),
            };
            const promotedInc = attachSpan("macro", incTarget, obs.span);
            if (promotedInc) {
              nodes = upsertNode(nodes, promotedInc);
              yield { type: "node", node: promotedInc };
            }
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
      const claimNode = firstOfKind(nodes, "claim");
      if (claimNode) {
        yield {
          type: "edge",
          edge: makeEdge(input.runId, claimNode.id, created.id, "causal"),
        };
      }
    }
  }

  return { nodes, spans: collectedSpans };
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
  const lead = nodes.filter(
    (node) => node.kind === "claim" || node.kind === "incidence" || node.kind === "mechanism",
  );
  const rest = nodes.filter(
    (node) => node.kind !== "claim" && node.kind !== "incidence" && node.kind !== "mechanism",
  );
  const lines = (lead.length > 0 ? lead : nodes).map(
    (node) =>
      `- **${node.title}** [${shortNodeKey(node.id)}] — ${node.body}${
        node.status === "supported" ? " *(supported by MCP span)*" : ""
      }`,
  );
  return {
    brief: [
      `## Executive Summary`,
      `${question}`,
      "",
      "## Core Policy Findings",
      ...lines,
    ].join("\n"),
    appendix: rest
      .map(
        (node) =>
          `## ${node.kind.toUpperCase()}: ${node.title}\n${node.body} [${shortNodeKey(node.id)}]`,
      )
      .join("\n\n"),
    updatedAt: nowIso(),
  };
}

export function normalizeNodeCitations(
  text: string,
  nodes: DigressionNode[],
): string {
  let out = text;
  for (const node of nodes) {
    const short = shortNodeKey(node.id);
    // Replace full UUID node.id with clean [shortKey] for readability while keeping resolution exact
    out = out.replaceAll(`[${node.id}]`, `[${short}]`);
  }
  return out;
}

export function draftCitesNodes(text: string, nodes: DigressionNode[]): boolean {
  return nodes.some((node) => {
    const short = shortNodeKey(node.id);
    return (
      text.includes(node.id) ||
      text.includes(`[${short}]`) ||
      text.toLowerCase().includes(`[${short.toLowerCase()}]`)
    );
  });
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
    `Trace verified: ${spans} MCP span${spans === 1 ? "" : "s"}, ${supported} supported node${
      supported === 1 ? "" : "s"
    }.`,
  );
}
