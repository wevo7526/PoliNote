import type {
  DigressionEdge,
  DigressionGraph,
  DigressionNode,
  ScopeContract,
} from "@/schemas";

const RUN_ID = "run_ev_tariff_static";
const TS = "2026-09-03T18:00:00.000Z";

/** Static Scope Contract for the EV-tariff digression (no LLM). */
export const evTariffScope: ScopeContract = {
  id: "scope_ev_tariff_us",
  question:
    "What are the near-term US price, employment, and fiscal effects of a 25% ad valorem tariff on imported battery-electric vehicles?",
  jurisdiction: "United States (federal)",
  horizon: "2026–2028 (near-term, pre-full domestic capacity ramp)",
  objective:
    "Map mechanisms and evidence for retail EV prices, auto employment, and tariff revenue — with distributional cuts by income quintile and region.",
  instrument: "25% ad valorem MFN tariff on imported BEVs (HS 8703 electric)",
  target: "US BEV retail prices, light-vehicle employment, federal tariff receipts",
  identificationStrategy:
    "Difference-in-differences / event-study vs ICE imports + pass-through elasticities from literature; FRED series for prices and employment as corroboration only",
  distributionalCut: "Income quintile × Census region; union vs non-union auto employment",
  baseline: "Status quo MFN + IRA domestic content incentives; no new Section 232/301 actions",
  allowedMethods: [
    "literature",
    "time_series",
    "legal_text",
    "macro",
    "incidence",
    "counterfactual",
  ],
  forbiddenMoves: [
    "Treat FRED correlations as causal identification",
    "Ignore IRA domestic content interaction",
    "Aggregate all light vehicles without BEV share",
  ],
  mcpAllowlist: {
    "econ-series": true,
    "policy-docs": true,
    literature: true,
    workspace: true,
    trace: true,
  },
  createdAt: TS,
  updatedAt: TS,
};

type NodeInput = Omit<
  DigressionNode,
  | "runId"
  | "createdAt"
  | "updatedAt"
  | "provenance"
  | "evidenceSpanIds"
  | "body"
  | "confidence"
> &
  Partial<
    Pick<
      DigressionNode,
      | "provenance"
      | "evidenceSpanIds"
      | "body"
      | "confidence"
      | "createdAt"
      | "updatedAt"
    >
  >;

function node({
  provenance = [],
  evidenceSpanIds = [],
  body = "",
  confidence = "unknown",
  createdAt = TS,
  updatedAt = TS,
  ...rest
}: NodeInput): DigressionNode {
  return {
    runId: RUN_ID,
    provenance,
    evidenceSpanIds,
    body,
    confidence,
    createdAt,
    updatedAt,
    ...rest,
  };
}

function edge(
  partial: Omit<DigressionEdge, "runId" | "createdAt"> &
    Partial<Pick<DigressionEdge, "createdAt">>,
): DigressionEdge {
  return {
    runId: RUN_ID,
    createdAt: TS,
    ...partial,
  };
}

/**
 * Static digression graph for UI scaffolding — EV tariff question.
 * Statuses are illustrative; no LLM / MCP calls.
 */
export const evTariffGraph: DigressionGraph = {
  runId: RUN_ID,
  nodes: [
    node({
      id: "n_claim_price",
      kind: "claim",
      status: "proposed",
      title: "Retail BEV prices rise 8–15% in 12 months",
      body: "Pass-through of the 25% tariff is incomplete; domestic capacity and IRA credits mute full incidence on sticker price.",
      confidence: "medium",
      agent: "series",
      position: { x: 420, y: 40 },
    }),
    node({
      id: "n_mech_passthrough",
      kind: "mechanism",
      status: "proposed",
      title: "Import share × pass-through elasticity",
      body: "Price effect ≈ tariff × import share of BEV sales × estimated pass-through (literature band 0.4–0.8).",
      confidence: "medium",
      agent: "literature",
      position: { x: 80, y: 180 },
    }),
    node({
      id: "n_ev_fred_cpi",
      kind: "evidence",
      status: "supported",
      title: "FRED: CPI new vehicles / EV proxies",
      body: "Placeholder evidence node — will bind to econ-series MCP spans (search_series / get_observations).",
      confidence: "low",
      agent: "series",
      evidenceSpanIds: ["span_fred_placeholder_001"],
      provenance: [
        {
          source: "econ-series",
          label: "FRED (placeholder)",
          spanId: "span_fred_placeholder_001",
        },
      ],
      position: { x: 80, y: 360 },
    }),
    node({
      id: "n_claim_emp",
      kind: "claim",
      status: "contested",
      title: "Net auto employment effect ambiguous",
      body: "Assembly gains from substitution to domestic BEVs vs parts/import-chain losses; sign depends on capacity utilization.",
      confidence: "low",
      agent: "incidence",
      position: { x: 760, y: 40 },
    }),
    node({
      id: "n_inc_quintile",
      kind: "incidence",
      status: "proposed",
      title: "Burden skews to upper-middle buyers",
      body: "BEV buyers concentrate in Q4–Q5; used-vehicle spillovers may hit Q2–Q3 with lag.",
      confidence: "medium",
      agent: "incidence",
      position: { x: 760, y: 200 },
    }),
    node({
      id: "n_cf_no_ira",
      kind: "counterfactual",
      status: "proposed",
      title: "Counterfactual: tariff without IRA credits",
      body: "Remove clean-vehicle credit interaction — price pass-through rises; domestic share response weakens.",
      confidence: "low",
      agent: "macro",
      position: { x: 420, y: 220 },
    }),
    node({
      id: "n_legal_hs",
      kind: "constraint",
      status: "supported",
      title: "HS classification + MFN binding",
      body: "Tariff applies to BEV passenger cars under HS 8703; WTO MFN unless Section 301/232 overlay.",
      confidence: "high",
      agent: "legal",
      evidenceSpanIds: ["span_policy_docs_placeholder_001"],
      provenance: [
        {
          source: "policy-docs",
          label: "HTS / govinfo (stub)",
          spanId: "span_policy_docs_placeholder_001",
        },
      ],
      position: { x: 420, y: 400 },
    }),
    node({
      id: "n_unc_elasticity",
      kind: "uncertainty",
      status: "proposed",
      title: "Pass-through band is wide",
      body: "Literature estimates disagree; firm pricing power and inventory buffers dominate near-term.",
      confidence: "high",
      agent: "critic",
      position: { x: 80, y: 520 },
    }),
    node({
      id: "n_fork_retaliation",
      kind: "fork",
      status: "proposed",
      title: "Fork: partner retaliation on US auto exports",
      body: "Branch not expanded in static scaffold — prune or force in later phases.",
      confidence: "unknown",
      agent: "scoper",
      position: { x: 760, y: 400 },
    }),
  ],
  edges: [
    edge({
      id: "e1",
      sourceId: "n_mech_passthrough",
      targetId: "n_claim_price",
      kind: "supports",
      label: "mechanism",
    }),
    edge({
      id: "e2",
      sourceId: "n_ev_fred_cpi",
      targetId: "n_mech_passthrough",
      kind: "supports",
      label: "series",
    }),
    edge({
      id: "e3",
      sourceId: "n_unc_elasticity",
      targetId: "n_claim_price",
      kind: "attacks",
      label: "uncertainty",
    }),
    edge({
      id: "e4",
      sourceId: "n_legal_hs",
      targetId: "n_claim_price",
      kind: "depends_on",
      label: "scope",
    }),
    edge({
      id: "e5",
      sourceId: "n_cf_no_ira",
      targetId: "n_claim_price",
      kind: "alternatives",
      label: "counterfactual",
    }),
    edge({
      id: "e6",
      sourceId: "n_inc_quintile",
      targetId: "n_claim_emp",
      kind: "elaborates",
    }),
    edge({
      id: "e7",
      sourceId: "n_fork_retaliation",
      targetId: "n_claim_emp",
      kind: "alternatives",
      label: "fork",
    }),
    edge({
      id: "e8",
      sourceId: "n_legal_hs",
      targetId: "n_claim_emp",
      kind: "depends_on",
    }),
  ],
};

export const EV_TARIFF_RUN_ID = RUN_ID;
