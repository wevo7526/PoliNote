import { allowRoleAction } from "@/agents/walls";
import type { CrewRole } from "@/agents/roles";
import type { CrewStreamEvent } from "@/lib/ai/crew-events";
import { workingStatus } from "@/lib/ai/crew-events";
import {
  buildProviderSearchQuery,
  deriveObservationWindow,
  selectAndValidateLiveSeries,
  type SeriesSelectionReport,
} from "@/lib/data/selector";
import type { DataProvenance, FetchedSeriesBundle, RawSnapshotRecord } from "@/lib/data/types";
import {
  executeEconometricEstimate,
  runAutomaticRobustnessSuite,
} from "@/lib/economics/estimators";
import type {
  EconometricEstimate,
  EconometricMethodId,
  RobustnessBundle,
} from "@/lib/economics/schemas";
import { serverForTool } from "@/lib/mcp/catalog";
import { cleanFredSearchText, type FredSeries } from "@/lib/mcp/fred";
import { redactSecrets } from "@/lib/mcp/http";
import type { ExtractedLiteratureEstimate } from "@/lib/mcp/openalex";
import { ensureMcpTools } from "@/lib/mcp/register";
import type { RunDraft } from "@/lib/platform-types";
import { shortNodeKey } from "@/lib/ui/prose";
import {
  evaluateClaimStatusFromEstimate,
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
  policyDate: string | null;
  observationStart: string;
  observationEnd: string;
};

type ScopeBits = {
  instrument: string;
  target: string;
  jurisdiction: string;
  distributionalCut: string;
  horizon?: string;
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
  const win = deriveObservationWindow({
    question: combined,
    horizon: scope.horizon,
  });
  return {
    fred: buildProviderSearchQuery(combined),
    lit: seedQuery(question, "empirical economics identification elasticity", 80),
    policy: seedQuery(`${question} ${scope.jurisdiction.slice(0, 60)}`, "statute regulation", 80),
    macro: buildProviderSearchQuery(`${scope.target} ${scope.distributionalCut}`),
    policyDate: win.policyDate,
    observationStart: win.observationStart,
    observationEnd: win.observationEnd,
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
): Promise<{
  event: CrewStreamEvent;
  span: EvidenceSpan | null;
  data: unknown;
  ok: boolean;
  error?: string;
}> {
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
      ok: result.ok,
      error: result.error,
    };
  } catch (error) {
    const message = publicToolError(
      error instanceof Error ? error.message : `${tool} failed`,
    );
    return {
      event: mcpEvent(agent, tool, false, message),
      span: null,
      data: null,
      ok: false,
      error: message,
    };
  }
}

/**
 * Attaches an MCP evidence span to a node.
 * NON-NEGOTIABLE RULE: `attachSpan` NEVER sets status = "supported" or raises confidence.
 * It only transitions `proposed` -> `data_attached`.
 */
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
    vintage: span.vintage,
    resultHash: span.resultHash,
    seriesPoints: span.seriesPoints,
  };
  const provenance = [
    ...node.provenance.filter((item) => item.spanId !== span.id),
    chip,
  ];
  const nextStatus =
    node.status === "proposed" ? ("data_attached" as const) : node.status;

  return {
    ...node,
    evidenceSpanIds: ids,
    provenance,
    status: nextStatus,
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
  extra?: Partial<DigressionNode>,
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
    confidence: "unknown",
    agent: role,
    provenance: [],
    position: { x: 0, y: 0 },
    evidenceSpanIds: [],
    createdAt: ts,
    updatedAt: ts,
    ...extra,
  };
}

function makeEdge(
  runId: string,
  sourceId: string,
  targetId: string,
  kind: DigressionEdge["kind"],
  label?: string,
): DigressionEdge {
  return {
    id: `${runId}_e_${slugKey(sourceId)}_${slugKey(targetId)}_${kind}`.slice(0, 80),
    runId,
    sourceId,
    targetId,
    kind,
    label,
    createdAt: nowIso(),
  };
}

function makeAnalysis(
  node: DigressionNode,
  span: EvidenceSpan | null,
  estimate?: EconometricEstimate | null,
  robustness?: RobustnessBundle | null,
): NodeAnalysis {
  const pts = span?.seriesPoints ?? [];
  const latest = pts[pts.length - 1];
  const earliest = pts[0];
  const seriesSummary =
    pts.length >= 2 && latest && earliest
      ? `Observed across ${pts.length} periods (${earliest.date} = ${earliest.value} to ${latest.date} = ${latest.value}${span?.units ? ` ${span.units}` : ""}, vintage ${span?.vintage ?? "latest"}, sha256=${span?.resultHash.slice(0, 12)}).`
      : "";

  const estSummary = estimate
    ? `Estimated via ${estimate.methodLabel} [${estimate.honestyLabel}]: β = ${estimate.pointEstimate} (SE = ${estimate.standardError}, 95% CI [${estimate.ciLower}, ${estimate.ciUpper}], p = ${estimate.pValue}, N = ${estimate.sampleSize}, ${estimate.seMethod}). Pre-registration lock hash: ${estimate.spec.preRegistration.lockHash.slice(0, 12)}.`
    : "No econometric estimate computed on this node.";

  const robSummary = robustness
    ? robustness.summary
    : "Automatic robustness curve runs on the primary outcome series.";

  const body = [
    "## Mechanism",
    `${node.body} ${seriesSummary}`.trim(),
    "",
    "## Identification",
    estSummary,
    "",
    "## Incidence",
    span
      ? `Backed by live MCP span ${span.id} (${span.tool} · ${span.citation}).`
      : "No live MCP span attached.",
    "",
    "## Sign flip",
    robSummary,
    "",
    "## Missing evidence",
    span
      ? `Live snapshot SHA-256 (${span.resultHash.slice(0, 16)}) stored in run record.`
      : "Requires a live provider series or quote-backed literature span.",
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
    `Data Scout locking live queries & window (${queries.observationStart} → ${queries.observationEnd})…`,
  );
  const memo = [
    `question: ${input.question}`,
    `fred_query: ${queries.fred}`,
    `window: ${queries.observationStart} to ${queries.observationEnd} (policyDate=${queries.policyDate ?? "none"})`,
    `lit_query: ${queries.lit}`,
    `policy_query: ${queries.policy}`,
    `macro_query: ${queries.macro}`,
  ].join("\n");
  const written = await invoke("data_scout", "workspace.write_memo", {
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
      agent: "data_scout",
      text: `Pre-registered empirical search protocol: observation window ${queries.observationStart} to ${queries.observationEnd}${queries.policyDate ? ` (policy date ${queries.policyDate})` : ""}, primary series query “${queries.fred}”, literature query “${queries.lit}”, and statutory query “${queries.policy}”.`,
    },
  };
  return queries;
}

export type McpSpecialistsResult = {
  nodes: DigressionNode[];
  spans: EvidenceSpan[];
  bundles: FetchedSeriesBundle[];
  snapshots: RawSnapshotRecord[];
  estimates: EconometricEstimate[];
  robustness: RobustnessBundle[];
  literatureEstimates: ExtractedLiteratureEstimate[];
  selectionReport: SeriesSelectionReport | null;
  dataErrors: string[];
};

export async function* streamMcpSpecialists(input: {
  userId: string;
  runId: string;
  contract: ScopeContract;
  scope: ScopeBits;
  queries: SpecialistQueries;
  nodes: DigressionNode[];
  preferredMethod?: EconometricMethodId;
  hypothesizedDirection?: "positive" | "negative" | "ambiguous";
}): AsyncGenerator<CrewStreamEvent, McpSpecialistsResult> {
  const allow = input.contract.mcpAllowlist;
  const methods = new Set(input.scope.allowedMethods);
  let nodes = input.nodes.slice();
  const collectedSpans: EvidenceSpan[] = [];
  const bundles: FetchedSeriesBundle[] = [];
  const snapshots: RawSnapshotRecord[] = [];
  const estimates: EconometricEstimate[] = [];
  const robustnessList: RobustnessBundle[] = [];
  const literatureEstimates: ExtractedLiteratureEstimate[] = [];
  const dataErrors: string[] = [];

  // 1. Live Series Selection & Metadata Validation via Data Scout
  let selectionReport: SeriesSelectionReport | null = null;
  if (allow["econ-series"]) {
    yield workingStatus("Data Scout validating live candidate series across providers…");
    try {
      selectionReport = await selectAndValidateLiveSeries({
        question: `${input.contract.question} ${input.scope.instrument} ${input.scope.target}`,
        horizon: input.scope.horizon,
        policyDate: input.queries.policyDate ?? undefined,
        extraQueries: [input.queries.fred, input.queries.macro],
        maxSelected: 3,
      });
      for (const err of selectionReport.providerErrors) {
        dataErrors.push(err.message);
      }
    } catch (error) {
      dataErrors.push(
        error instanceof Error ? error.message : "Data unavailable: live series selector failed",
      );
    }
  }

  type Invoked = {
    role: CrewRole;
    tool: ToolName;
    event: CrewStreamEvent;
    span: EvidenceSpan | null;
    data: unknown;
    ok: boolean;
    error?: string;
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
        ok: result.ok,
        error: result.error,
      })),
    );
  };

  if (allow["econ-series"] && (!selectionReport || selectionReport.selected.length === 0)) {
    yield workingStatus("Data Scout querying FRED search endpoint…");
    queue("data_scout", "econ.search_series", { query: input.queries.fred });
  }
  if (allow.literature) {
    yield workingStatus("Literature Analyst searching OpenAlex for quote-backed estimates…");
    queue("literature_analyst", "lit.search", { query: input.queries.lit });
  }
  if (allow["policy-docs"]) {
    yield workingStatus("Checking official statutory & congressional records…");
    queue("legal", "policy.search", { query: input.queries.policy });
  }

  const settled = await Promise.all(jobs);
  for (const result of settled) {
    yield result.event;
    if (result.span) collectedSpans.push(result.span);
    if (!result.ok && result.error) {
      dataErrors.push(result.error);
    }
  }

  // Determine candidate series IDs from Data Scout validation report or live search
  const selectedIds: Array<{ id: string; title?: string; units?: string }> = [];
  if (selectionReport && selectionReport.selected.length > 0) {
    for (const cand of selectionReport.selected.slice(0, 2)) {
      selectedIds.push({
        id: cand.metadata.id,
        title: cand.metadata.title,
        units: cand.metadata.units,
      });
    }
  } else {
    const seriesSearch = settled.find((item) => item.tool === "econ.search_series");
    const list =
      seriesSearch?.data &&
      typeof seriesSearch.data === "object" &&
      Array.isArray((seriesSearch.data as { series?: FredSeries[] }).series)
        ? (seriesSearch.data as { series: FredSeries[] }).series
        : [];
    for (const s of list.slice(0, 2)) {
      if (s.id) selectedIds.push({ id: s.id, title: s.title, units: s.units });
    }
  }

  // Pull live observations for the top validated series (primary outcome + optional control)
  for (const [idx, seriesLead] of selectedIds.entries()) {
    yield workingStatus(
      `Fetching live observations for ${seriesLead.id} (${input.queries.observationStart} → ${input.queries.observationEnd})…`,
    );
    const obs = await invoke("data_scout", "econ.get_observations", {
      seriesId: seriesLead.id,
      title: seriesLead.title,
      units: seriesLead.units,
      question: input.contract.question,
      policyDate: input.queries.policyDate,
      observationStart: input.queries.observationStart,
      observationEnd: input.queries.observationEnd,
    });
    yield obs.event;

    if (!obs.ok || !obs.span || !obs.data) {
      if (obs.error) dataErrors.push(obs.error);
      continue;
    }

    collectedSpans.push(obs.span);
    const obsData = obs.data as {
      seriesId: string;
      title: string;
      units: string;
      provenance?: DataProvenance;
      snapshot?: RawSnapshotRecord;
      seriesPoints: Array<{ date: string; value: number }>;
    };

    if (obsData.snapshot) {
      snapshots.push(obsData.snapshot);
    }
    if (obsData.provenance && obsData.seriesPoints.length > 0) {
      bundles.push({
        metadata: {
          provider: obsData.provenance.source,
          id: obsData.seriesId,
          title: obsData.title,
          units: obsData.units,
          frequency: obsData.provenance.frequency,
          frequencyShort: "unknown",
          seasonalAdjustment: obsData.provenance.seasonalAdjustment,
          observationStart: obsData.provenance.observationWindow.start,
          observationEnd: obsData.provenance.observationWindow.end,
          lastUpdated: obsData.provenance.lastUpdated,
          discontinued: false,
          copyrightedThirdParty: obsData.provenance.copyrightedThirdParty,
          licenseAttribution: obsData.provenance.licenseAttribution,
          sourceUrl: obsData.provenance.url,
        },
        observations: obsData.seriesPoints,
        provenance: obsData.provenance,
        snapshot: obsData.snapshot ?? {
          id: `snap_${obsData.seriesId}`,
          provider: obsData.provenance.source,
          seriesId: obsData.seriesId,
          requestUrl: obsData.provenance.url,
          retrievedAt: obsData.provenance.retrievedAt,
          sha256: obsData.provenance.payloadSha256,
          byteLength: obsData.seriesPoints.length * 24,
          rawJson: "[]",
        },
      });
    }

    const nodeKey = idx === 0 ? "ev_fred" : "ev_macro";
    const existing = findByKey(nodes, input.runId, nodeKey);
    let evNode =
      existing ??
      makeNode(
        "data_scout",
        input.runId,
        nodeKey,
        "evidence",
        seriesLead.title
          ? `${seriesLead.id}: ${seriesLead.title.slice(0, 44)}`
          : `FRED ${seriesLead.id}`,
        obs.span.citation,
        { honestyLabel: "Descriptive" },
      );

    if (evNode) {
      const attached = attachSpan("data_scout", evNode, obs.span);
      if (attached) {
        evNode = attached;
        nodes = upsertNode(nodes, evNode);
        yield { type: "node", node: evNode };
        yield { type: "analysis", analysis: makeAnalysis(evNode, obs.span) };

        const targetNode =
          idx === 0
            ? firstOfKind(nodes, "claim")
            : (firstOfKind(nodes, "incidence") ?? firstOfKind(nodes, "claim"));
        if (targetNode && targetNode.id !== evNode.id) {
          yield {
            type: "edge",
            edge: makeEdge(
              input.runId,
              evNode.id,
              targetNode.id,
              idx === 0 ? "supports" : "elaborates",
            ),
          };
        }
      }
    }
  }

  // 2. Econometrician: Run real estimation + automatic robustness on live bundles
  // and set Claim status ONLY via deterministic code rule (`evaluateClaimStatusFromEstimate`).
  const claimTarget = firstOfKind(nodes, "claim");
  if (bundles.length > 0) {
    const primaryBundle = bundles[0]!;
    const controlBundles = bundles.slice(1);
    const chosenMethod: EconometricMethodId =
      input.preferredMethod ?? "event_study";

    yield workingStatus(
      `Econometrician running ${chosenMethod} & automatic specification curve on ${primaryBundle.metadata.id}…`,
    );

    try {
      const headlineEst = executeEconometricEstimate({
        method: chosenMethod,
        outcome: primaryBundle,
        policyDate: input.queries.policyDate,
        scopeId: input.contract.id,
        controls: controlBundles,
      });
      estimates.push(headlineEst);

      const lpEst = executeEconometricEstimate({
        method: "local_projections_jorda",
        outcome: primaryBundle,
        policyDate: headlineEst.spec.policyDate,
        scopeId: input.contract.id,
      });
      estimates.push(lpEst);

      const robBundle = runAutomaticRobustnessSuite({
        headline: headlineEst,
        outcome: primaryBundle,
        controls: controlBundles,
        scopeId: input.contract.id,
      });
      robustnessList.push(robBundle);

      yield {
        type: "narration",
        item: {
          id: crypto.randomUUID(),
          kind: "narration",
          agent: "econometrician",
          text: `Executed pre-registered ${headlineEst.methodLabel} on ${primaryBundle.metadata.id} (lock=${headlineEst.spec.preRegistration.lockHash.slice(0, 10)}, N=${headlineEst.sampleSize}, window ${headlineEst.sampleWindow.start} to ${headlineEst.sampleWindow.end}): point estimate β = ${headlineEst.pointEstimate} (SE = ${headlineEst.standardError}, 95% CI [${headlineEst.ciLower}, ${headlineEst.ciUpper}], p = ${headlineEst.pValue}, ${headlineEst.seMethod}). ${robBundle.summary}`,
        },
      };

      if (claimTarget) {
        const evalResult = evaluateClaimStatusFromEstimate({
          estimate: headlineEst,
          robustness: robBundle,
          hypothesizedDirection:
            claimTarget.hypothesizedDirection ??
            input.hypothesizedDirection ??
            "ambiguous",
        });

        const primarySpan = collectedSpans.find(
          (s) => s.seriesId === primaryBundle.metadata.id,
        );
        const spanIds = primarySpan
          ? [...new Set([...claimTarget.evidenceSpanIds, primarySpan.id])]
          : claimTarget.evidenceSpanIds;

        const updatedClaim: DigressionNode = {
          ...claimTarget,
          status: evalResult.status,
          confidence: evalResult.confidence,
          honestyLabel: evalResult.honestyLabel,
          estimateId: headlineEst.id,
          statusReason: evalResult.reason,
          evidenceSpanIds: spanIds,
          updatedAt: nowIso(),
        };
        nodes = upsertNode(nodes, updatedClaim);
        yield { type: "node", node: updatedClaim };
        yield {
          type: "analysis",
          analysis: makeAnalysis(updatedClaim, primarySpan ?? null, headlineEst, robBundle),
        };
      }
    } catch (error) {
      const errMsg =
        error instanceof Error ? error.message : "Econometric estimation failed";
      dataErrors.push(errMsg);
    }
  } else if (claimTarget) {
    // No live data available -> mark claim unverifiable visibly, never substitute fake data
    const reason =
      dataErrors[0] ??
      "Data unavailable: FRED_API_KEY missing or no live series matched query.";
    const unverifiableClaim: DigressionNode = {
      ...claimTarget,
      status: "unverifiable",
      confidence: "unknown",
      honestyLabel: "Descriptive",
      statusReason: reason,
      updatedAt: nowIso(),
    };
    nodes = upsertNode(nodes, unverifiableClaim);
    yield { type: "node", node: unverifiableClaim };
    yield {
      type: "flag",
      nodeId: unverifiableClaim.id,
      message: reason,
    };
  }

  // 3. Literature Analyst: attach OpenAlex works and extracted quote-span estimates
  const lit = settled.find((item) => item.tool === "lit.search");
  if (lit?.span) {
    const works =
      lit.data && typeof lit.data === "object"
        ? ((lit.data as { works?: ExtractedLiteratureEstimate[] }).works ?? [])
        : [];
    literatureEstimates.push(...works);

    if (works.length > 0) {
      const existing = findByKey(nodes, input.runId, "ev_openalex");
      const firstWork = works[0]!;
      const quoteNote =
        firstWork.pointEstimate !== undefined && firstWork.quoteSpan
          ? `Extracted estimate: ${firstWork.pointEstimate} ${firstWork.unitsOrMetric ?? ""} — “${firstWork.quoteSpan}”`
          : lit.span.citation;
      let node =
        existing ??
        makeNode(
          "literature_analyst",
          input.runId,
          "ev_openalex",
          "evidence",
          firstWork.title.slice(0, 68) || "OpenAlex empirical study",
          quoteNote,
          { honestyLabel: firstWork.honestyLabel },
        );
      if (node) {
        const attached = attachSpan("literature_analyst", node, lit.span);
        if (attached) {
          node = attached;
          nodes = upsertNode(nodes, node);
          yield { type: "node", node };
          yield { type: "analysis", analysis: makeAnalysis(node, lit.span) };

          // Link literature evidence to Mechanism node (without auto-marking Mechanism as supported!)
          const mechTarget =
            firstOfKind(nodes, "mechanism") ?? firstOfKind(nodes, "claim");
          if (mechTarget && mechTarget.id !== node.id) {
            yield {
              type: "edge",
              edge: makeEdge(input.runId, node.id, mechTarget.id, "supports"),
            };
          }
        }
      }
    }
  }

  // 4. Policy Docs
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
          { honestyLabel: "Descriptive" },
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

  if (!firstOfKind(nodes, "incidence") && methods.has("incidence")) {
    const created = makeNode(
      "econometrician",
      input.runId,
      "inc_winners",
      "incidence",
      "Distributional & Sectoral Incidence",
      input.scope.distributionalCut.slice(0, 360),
      { honestyLabel: "Descriptive" },
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

  return {
    nodes,
    spans: collectedSpans,
    bundles,
    snapshots,
    estimates,
    robustness: robustnessList,
    literatureEstimates,
    selectionReport,
    dataErrors,
  };
}

/**
 * Skeptic & Verification Wall:
 * Enforces that no claim can be `supported` without an econometric `estimateId`
 * and flags any untested or data-missing claims.
 */
export function* applyCriticWalls(
  nodes: DigressionNode[],
): Generator<CrewStreamEvent, DigressionNode[]> {
  const next: DigressionNode[] = [];
  for (const node of nodes) {
    let updated = node;
    if (updated.status === "supported" && !updated.estimateId) {
      updated = {
        ...updated,
        status: updated.evidenceSpanIds.length > 0 ? "data_attached" : "proposed",
        statusReason:
          "Downgraded by verification wall: 'supported' status requires a computed econometric estimate.",
        updatedAt: nowIso(),
      };
    }
    if (
      updated.kind === "claim" &&
      !updated.estimateId &&
      updated.status !== "unverifiable" &&
      updated.status !== "rejected" &&
      updated.status !== "pruned"
    ) {
      updated = {
        ...updated,
        status: "unverifiable",
        statusReason:
          "No live econometric estimate attached; claim remains unverifiable until live series are estimated.",
        updatedAt: nowIso(),
      };
      yield {
        type: "flag",
        nodeId: updated.id,
        message: `${updated.title} has no live econometric estimate and is marked unverifiable.`,
      };
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
  estimates: EconometricEstimate[] = [],
  dataErrors: string[] = [],
): RunDraft {
  const lead = nodes.filter(
    (node) => node.kind === "claim" || node.kind === "incidence" || node.kind === "mechanism",
  );
  const rest = nodes.filter(
    (node) => node.kind !== "claim" && node.kind !== "incidence" && node.kind !== "mechanism",
  );
  const estSummary =
    estimates.length > 0
      ? estimates
          .map(
            (e) =>
              `- **${e.methodLabel}** (${e.honestyLabel}, series \`${e.spec.outcomeSeriesId}\`, window ${e.sampleWindow.start} to ${e.sampleWindow.end}, N=${e.sampleSize}): point estimate β = ${e.pointEstimate} (SE = ${e.standardError}, 95% CI [${e.ciLower}, ${e.ciUpper}], p = ${e.pValue}, ${e.seMethod}).`,
          )
          .join("\n")
      : `- **Data / Estimation Status**: ${dataErrors[0] ?? "Data unavailable: no live series observations were returned for estimation."}`;

  const lines = (lead.length > 0 ? lead : nodes).map(
    (node) =>
      `- **${node.title}** [${shortNodeKey(node.id)}] (${node.status}${node.honestyLabel ? ` · ${node.honestyLabel}` : ""}) — ${node.body}`,
  );
  return {
    brief: [
      `## Executive Summary`,
      `${question}`,
      "",
      "## Econometric Estimates & Honesty Labels",
      estSummary,
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
  const tested = input.nodes.filter(
    (node) =>
      node.status === "supported" ||
      node.status === "contradicted" ||
      node.status === "inconclusive" ||
      node.status === "tested",
  ).length;
  const spans = input.nodes.reduce((sum, node) => sum + node.evidenceSpanIds.length, 0);
  yield workingStatus(
    `Trace verified: ${spans} live data span${spans === 1 ? "" : "s"}, ${tested} tested claim${tested === 1 ? "" : "s"} (${supported} supported).`,
  );
}
