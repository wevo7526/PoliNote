import { humanAgent } from "@/lib/ai/event-view";
import type {
  DigressionEdge,
  DigressionEdgeKind,
  DigressionNode,
  DigressionNodeKind,
  DigressionNodeStatus,
} from "@/schemas/digression";
import type { RunEvent } from "@/schemas/run-event";

export type NodeKindInfo = {
  kind: DigressionNodeKind;
  /** Plain-English title shown in modals, legends, and tooltips */
  label: string;
  /** Crisp 1-2 word badge shown on graph cards */
  shortLabel: string;
  /** Stage / lane in the argument */
  stage: string;
  color: string;
  /** What this node type means in plain English */
  meaning: string;
  /** What role this node plays in building or testing the policy output */
  whatItDoes: string;
};

export const NODE_KIND_TAXONOMY: Record<DigressionNodeKind, NodeKindInfo> = {
  constraint: {
    kind: "constraint",
    label: "Policy Instrument & Legal Rule",
    shortLabel: "Policy Rule",
    stage: "01 · Instrument",
    color: "#c9a27a",
    meaning:
      "The concrete law, tariff, tax credit, zoning mandate, or regulatory rule being evaluated — along with its legal boundaries.",
    whatItDoes:
      "Anchors the start of the argument so the crew analyzes the actual statutory tool rather than a vague slogan.",
  },
  mechanism: {
    kind: "mechanism",
    label: "Economic Mechanism & Identification",
    shortLabel: "Mechanism",
    stage: "02 · Mechanism",
    color: "#8fbfb0",
    meaning:
      "The causal transmission channel (price pass-through, factor substitution, capital formation) and identification design.",
    whatItDoes:
      "Connects the policy rule to the testable outcome and states the identifying assumptions.",
  },
  claim: {
    kind: "claim",
    label: "Testable Econometric Claim",
    shortLabel: "Core Claim",
    stage: "03 · Core Finding",
    color: "#d4b483",
    meaning:
      "A falsifiable prediction about how the policy shifts the target series relative to the counterfactual.",
    whatItDoes:
      "Evaluated strictly by code rules on the econometric estimate (sign, 95% CI, pre-trend test, and robustness pass rate).",
  },
  evidence: {
    kind: "evidence",
    label: "Live Series, Estimate & Literature Proof",
    shortLabel: "Empirical Proof",
    stage: "04 · Evidence & Estimates",
    color: "#9bb4d4",
    meaning:
      "Live data pulled from FRED/ALFRED, BEA, BLS, Census, or World Bank, computed econometric estimates, and quote-backed OpenAlex studies.",
    whatItDoes:
      "Carries full provenance, SHA-256 raw snapshot hash, vintage stamp, and standard errors.",
  },
  incidence: {
    kind: "incidence",
    label: "Distributional & Sectoral Incidence",
    shortLabel: "Who Pays / Gains",
    stage: "05 · Distributional Impact",
    color: "#d4a08c",
    meaning:
      "The breakdown of statutory vs. economic incidence across households, workers, firms, and public budgets.",
    whatItDoes:
      "Reveals how elasticities and market structure split the real burden of the policy.",
  },
  counterfactual: {
    kind: "counterfactual",
    label: "Counterfactual & Pre-Policy Forecast",
    shortLabel: "Counterfactual",
    stage: "Digression Branch",
    color: "#b5a4d4",
    meaning:
      "The estimated trajectory absent the policy intervention (AR/ARIMA projection, Synthetic Control donor hull, or untreated comparison group).",
    whatItDoes:
      "Benchmarks post-policy actuals against an explicit statistical counterfactual with confidence intervals.",
  },
  fork: {
    kind: "fork",
    label: "Pre-Registration Fork (Alternative Spec)",
    shortLabel: "Spec Fork",
    stage: "Digression Branch",
    color: "#d48ca0",
    meaning:
      "A branch that modifies the scope, outcome series, estimator, observation window, or transform and re-runs live estimation.",
    whatItDoes:
      "Allows side-by-side comparison of how changing an assumption or sample window alters the estimate.",
  },
  uncertainty: {
    kind: "uncertainty",
    label: "Skeptic Red-Team Critique & Threats",
    shortLabel: "Skeptic Critique",
    stage: "Digression Branch",
    color: "#a8a29a",
    meaning:
      "Named confounders, reverse-causality risks, pre-trend violations, or specification fragility raised by the Skeptic.",
    whatItDoes:
      "Lists concrete 'What would change my mind' falsification tests that can be launched as live forks.",
  },
};

export type StatusInfo = {
  status: DigressionNodeStatus;
  label: string;
  shortLabel: string;
  color: string;
  bgColor: string;
  meaning: string;
};

export const NODE_STATUS_TAXONOMY: Record<DigressionNodeStatus, StatusInfo> = {
  supported: {
    status: "supported",
    label: "Supported by Econometric Estimate",
    shortLabel: "Supported",
    color: "#8fbf9a",
    bgColor: "rgba(143,191,154,0.18)",
    meaning:
      "Set by code rule: estimate sign matches hypothesis, 95% CI excludes zero, pre-trend test passes, and >=60% of robustness specifications hold.",
  },
  contradicted: {
    status: "contradicted",
    label: "Contradicted by Econometric Estimate",
    shortLabel: "Contradicted",
    color: "#d46a6a",
    bgColor: "rgba(212,106,106,0.18)",
    meaning:
      "Set by code rule: estimated effect has the opposite sign of the hypothesis and its 95% CI excludes zero.",
  },
  inconclusive: {
    status: "inconclusive",
    label: "Inconclusive (CI Includes Zero / Fragile)",
    shortLabel: "Inconclusive",
    color: "#d4b483",
    bgColor: "rgba(212,180,131,0.16)",
    meaning:
      "Tested with live data, but the 95% confidence interval includes zero, pre-trends fail, or the sign flips across robustness specs.",
  },
  tested: {
    status: "tested",
    label: "Tested (Econometric Estimate Computed)",
    shortLabel: "Tested",
    color: "#9bb4d4",
    bgColor: "rgba(155,180,212,0.18)",
    meaning:
      "Live series attached and econometric specification executed with standard errors and diagnostics.",
  },
  data_attached: {
    status: "data_attached",
    label: "Live Data Attached (Awaiting Test)",
    shortLabel: "Data Attached",
    color: "#8fbfb0",
    bgColor: "rgba(143,191,176,0.16)",
    meaning:
      "Backed by a live provider series or literature span with SHA-256 provenance, awaiting econometric estimation.",
  },
  unverifiable: {
    status: "unverifiable",
    label: "Unverifiable (Live Data Unavailable)",
    shortLabel: "Unverifiable",
    color: "#d46a6a",
    bgColor: "rgba(212,106,106,0.15)",
    meaning:
      "Required source API key is missing or upstream provider returned no observations. Never substituted with fallback data.",
  },
  contested: {
    status: "contested",
    label: "Contested / Skeptic Objection",
    shortLabel: "Contested",
    color: "#d4a08c",
    bgColor: "rgba(212,160,140,0.18)",
    meaning:
      "Flagged by the Skeptic or invalidated by a Scope edit due to identification confounders or missing estimation proof.",
  },
  proposed: {
    status: "proposed",
    label: "Proposed Hypothesis",
    shortLabel: "Proposed",
    color: "#d4b483",
    bgColor: "rgba(212,180,131,0.14)",
    meaning:
      "Initial hypothesis placed on the argument map; no live data or estimate attached yet.",
  },
  rejected: {
    status: "rejected",
    label: "Rejected",
    shortLabel: "Rejected",
    color: "#d46a6a",
    bgColor: "rgba(212,106,106,0.18)",
    meaning: "Refuted by empirical estimation or statutory bounds.",
  },
  pruned: {
    status: "pruned",
    label: "Pruned by Researcher",
    shortLabel: "Pruned",
    color: "#9a9284",
    bgColor: "rgba(154,146,132,0.14)",
    meaning:
      "Excluded from the active synthesis while preserved in the run event log.",
  },
};

export const EDGE_KIND_TAXONOMY: Record<
  DigressionEdgeKind,
  { label: string; verb: string; meaning: string }
> = {
  supports: {
    label: "Supports",
    verb: "provides evidence for",
    meaning: "Empirical data, estimate, or mechanism that corroborates the target node.",
  },
  causal: {
    label: "Drives →",
    verb: "transmits into",
    meaning: "Direct economic transmission link along the policy spine.",
  },
  depends_on: {
    label: "Depends On",
    verb: "is bound by",
    meaning: "Requires this statutory rule, pre-registration lock, or identifying assumption.",
  },
  elaborates: {
    label: "Details",
    verb: "adds empirical context to",
    meaning: "Expands the mechanism or robustness specification behind the node.",
  },
  attacks: {
    label: "Challenges",
    verb: "challenges or limits",
    meaning: "Identifies a confounder, pre-trend violation, or sign-flip risk.",
  },
  alternatives: {
    label: "Fork / Counterfactual",
    verb: "branches as an alternative to",
    meaning: "Presents a counterfactual baseline or alternative specification fork.",
  },
};

export type NodeTraceStep = {
  step: string;
  actor: string;
  detail: string;
  tone: "positive" | "warning" | "neutral";
};

export function buildNodeProvenanceTrace(
  node: DigressionNode,
  allNodes: DigressionNode[],
  edges: DigressionEdge[],
  events: RunEvent[] = [],
): {
  kindInfo: NodeKindInfo;
  statusInfo: StatusInfo;
  steps: NodeTraceStep[];
  upstream: Array<{ node: DigressionNode; edgeKind: DigressionEdgeKind }>;
  downstream: Array<{ node: DigressionNode; edgeKind: DigressionEdgeKind }>;
} {
  const kindInfo = NODE_KIND_TAXONOMY[node.kind];
  const statusInfo = NODE_STATUS_TAXONOMY[node.status] ?? NODE_STATUS_TAXONOMY.proposed;
  const byId = new Map(allNodes.map((n) => [n.id, n]));

  const upstream: Array<{ node: DigressionNode; edgeKind: DigressionEdgeKind }> = [];
  const downstream: Array<{ node: DigressionNode; edgeKind: DigressionEdgeKind }> = [];

  for (const edge of edges) {
    if (edge.targetId === node.id) {
      const src = byId.get(edge.sourceId);
      if (src) upstream.push({ node: src, edgeKind: edge.kind });
    } else if (edge.sourceId === node.id) {
      const tgt = byId.get(edge.targetId);
      if (tgt) downstream.push({ node: tgt, edgeKind: edge.kind });
    }
  }

  const steps: NodeTraceStep[] = [];

  steps.push({
    step: "1. Placed by Crew Role",
    actor: humanAgent(node.agent),
    detail: `Placed in "${kindInfo.stage}" as ${kindInfo.label}${node.honestyLabel ? ` · Honesty label: ${node.honestyLabel}` : ""}.`,
    tone: "neutral",
  });

  const mcpChips = node.provenance.filter((c) => c.spanId);
  if (mcpChips.length > 0) {
    steps.push({
      step: "2. Live Data Attached (SHA-256 Provenance)",
      actor: mcpChips.map((c) => c.source).join(", "),
      detail: mcpChips
        .map(
          (c) =>
            `${c.label} (span=${c.spanId}${c.vintage ? `, vintage=${c.vintage}` : ""})`,
        )
        .join(" · "),
      tone: "positive",
    });
  } else {
    steps.push({
      step: "2. Live Data Check",
      actor: "Data Scout",
      detail: "No direct live series span attached to this node.",
      tone: "warning",
    });
  }

  const criticFlags = events.filter(
    (ev) =>
      (ev.type === "critic.flag" || ev.type === "node.status_changed") &&
      ev.payload?.nodeId === node.id,
  );

  steps.push({
    step: "3. Econometric & Skeptic Audit",
    actor:
      node.status === "supported" ||
      node.status === "contradicted" ||
      node.status === "inconclusive"
        ? "Econometric Code Rule"
        : "Skeptic & Auditor",
    detail:
      node.statusReason ||
      (typeof criticFlags[criticFlags.length - 1]?.payload?.message === "string"
        ? String(criticFlags[criticFlags.length - 1]?.payload?.message)
        : statusInfo.meaning),
    tone:
      node.status === "supported" || node.status === "tested" || node.status === "data_attached"
        ? "positive"
        : node.status === "unverifiable" || node.status === "contradicted" || node.status === "contested"
          ? "warning"
          : "neutral",
  });

  return {
    kindInfo,
    statusInfo,
    steps,
    upstream,
    downstream,
  };
}
