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
    label: "Economic Mechanism (How It Works)",
    shortLabel: "Mechanism",
    stage: "02 · Mechanism",
    color: "#8fbfb0",
    meaning:
      "The real-world causal channel (such as price pass-through, supply-chain substitution, or capital investment) set in motion by the policy.",
    whatItDoes:
      "Connects the policy rule to the expected outcome and shows the step-by-step transmission path.",
  },
  claim: {
    kind: "claim",
    label: "Core Policy Finding (Expected Effect)",
    shortLabel: "Core Finding",
    stage: "03 · Core Finding",
    color: "#d4b483",
    meaning:
      "A testable prediction about how the policy changes prices, jobs, output, or fiscal revenue relative to the baseline.",
    whatItDoes:
      "Forms the central thesis of the policy brief. Must be backed by empirical data or literature to graduate to Verified.",
  },
  evidence: {
    kind: "evidence",
    label: "Empirical Data & Research Proof",
    shortLabel: "Empirical Data",
    stage: "04 · Evidence & Proof",
    color: "#9bb4d4",
    meaning:
      "Verifiable data pulled from FRED economic series, peer-reviewed OpenAlex studies, or official government records.",
    whatItDoes:
      "Provides the hashed proof span that upgrades a Working Hypothesis into a Verified finding and feeds the report's charts.",
  },
  incidence: {
    kind: "incidence",
    label: "Who Pays & Who Gains (Distributional Impact)",
    shortLabel: "Who Pays / Gains",
    stage: "05 · Distributional Impact",
    color: "#d4a08c",
    meaning:
      "The breakdown of winners and losers across households, workers, firms, and regions — distinct from who writes the statutory check.",
    whatItDoes:
      "Reveals the real economic burden and distributional tradeoff at the end of the policy chain.",
  },
  counterfactual: {
    kind: "counterfactual",
    label: "Baseline / What-If Scenario",
    shortLabel: "What-If Baseline",
    stage: "Digression Branch",
    color: "#b5a4d4",
    meaning:
      "What would happen if no new policy were enacted, or if an alternative policy instrument were chosen instead.",
    whatItDoes:
      "Prevents false attribution by comparing the policy against a realistic status-quo or alternative benchmark.",
  },
  fork: {
    kind: "fork",
    label: "Policy Design Branch (Alternative Path)",
    shortLabel: "Design Fork",
    stage: "Digression Branch",
    color: "#d48ca0",
    meaning:
      "A critical design choice or structural threshold (such as retaliation, exemptions, or capacity bottlenecks) where the outcome splits.",
    whatItDoes:
      "Maps how changing a key parameter or assumption flips the direction or magnitude of the policy effect.",
  },
  uncertainty: {
    kind: "uncertainty",
    label: "Key Risk & Evidence Gap",
    shortLabel: "Key Risk / Gap",
    stage: "Digression Branch",
    color: "#a8a29a",
    meaning:
      "An unmeasured confounder, data limitation, or identification risk that could weaken or reverse the conclusion.",
    whatItDoes:
      "Keeps the analysis honest by flagging where data is missing or where the Critic found an identification flaw.",
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
    label: "Verified by Empirical Data",
    shortLabel: "Verified",
    color: "#8fbf9a",
    bgColor: "rgba(143,191,154,0.18)",
    meaning:
      "Corroborated by at least one hashed MCP evidence span (FRED economic series, OpenAlex study, or official statutory text).",
  },
  contested: {
    status: "contested",
    label: "Contested / Needs Stronger Proof",
    shortLabel: "Needs Proof",
    color: "#d4a08c",
    bgColor: "rgba(212,160,140,0.18)",
    meaning:
      "Flagged by the Critic or invalidated by a Scope edit because it lacks direct empirical verification or faces confounders.",
  },
  proposed: {
    status: "proposed",
    label: "Working Hypothesis",
    shortLabel: "Hypothesis",
    color: "#d4b483",
    bgColor: "rgba(212,180,131,0.14)",
    meaning:
      "Placed on the map by the crew based on initial policy logic; awaiting empirical confirmation.",
  },
  rejected: {
    status: "rejected",
    label: "Refuted by Evidence",
    shortLabel: "Refuted",
    color: "#d46a6a",
    bgColor: "rgba(212,106,106,0.18)",
    meaning: "Contradicted by empirical series or statutory bounds.",
  },
  pruned: {
    status: "pruned",
    label: "Excluded by Researcher",
    shortLabel: "Excluded",
    color: "#9a9284",
    bgColor: "rgba(154,146,132,0.14)",
    meaning:
      "Set aside from the active policy report while remaining preserved in the audit trail.",
  },
};

export const EDGE_KIND_TAXONOMY: Record<
  DigressionEdgeKind,
  { label: string; verb: string; meaning: string }
> = {
  supports: {
    label: "Supports",
    verb: "provides evidence for",
    meaning: "Empirical data or mechanism that strengthens the target finding.",
  },
  causal: {
    label: "Drives →",
    verb: "directly causes or drives",
    meaning: "Direct cause-and-effect link along the policy spine.",
  },
  depends_on: {
    label: "Depends On",
    verb: "is legally or structurally bound by",
    meaning: "Requires this statutory rule, authority, or prerequisite to operate.",
  },
  elaborates: {
    label: "Details",
    verb: "adds empirical context to",
    meaning: "Expands the mechanism or macro benchmark behind the node.",
  },
  attacks: {
    label: "Challenges",
    verb: "challenges or limits",
    meaning: "Identifies a risk, confounder, or counter-force that weakens the claim.",
  },
  alternatives: {
    label: "What-If Branch",
    verb: "offers a counterfactual alternative to",
    meaning: "Presents an alternative policy design or baseline scenario.",
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
  const statusInfo = NODE_STATUS_TAXONOMY[node.status];
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

  // Step 1: Origin
  steps.push({
    step: "1. Created by Agent",
    actor: humanAgent(node.agent),
    detail: `Placed in "${kindInfo.stage}" as a ${kindInfo.label.toLowerCase()}.`,
    tone: "neutral",
  });

  // Step 2: Empirical MCP Spans or Web Leads
  const mcpChips = node.provenance.filter((c) => c.spanId);
  const webChips = node.provenance.filter((c) => !c.spanId);

  if (mcpChips.length > 0) {
    steps.push({
      step: "2. Empirical Data Attached (MCP)",
      actor: mcpChips.map((c) => c.source).join(", "),
      detail: mcpChips.map((c) => `${c.label} (${c.spanId})`).join(" · "),
      tone: "positive",
    });
  } else if (webChips.length > 0) {
    steps.push({
      step: "2. Initial Research Leads",
      actor: "Web & Literature Intake",
      detail: `Grounded with ${webChips.length} lead(s): ${webChips
        .map((c) => c.label)
        .slice(0, 2)
        .join("; ")}.`,
      tone: "neutral",
    });
  } else {
    steps.push({
      step: "2. Evidence Check",
      actor: "MCP Specialists",
      detail: "No direct FRED series or statutory span attached to this node yet.",
      tone: "warning",
    });
  }

  // Step 3: Critic / Status Audit
  const criticFlags = events.filter(
    (ev) =>
      (ev.type === "critic.flag" || ev.type === "node.status_changed") &&
      ev.payload?.nodeId === node.id,
  );
  if (node.status === "supported") {
    steps.push({
      step: "3. Verification Audit",
      actor: "Critic & Verification Wall",
      detail: `Graduated to Verified (${mcpChips.length} hashed MCP span${mcpChips.length === 1 ? "" : "s"} attached).`,
      tone: "positive",
    });
  } else if (node.status === "contested") {
    const flagMsg =
      typeof criticFlags[criticFlags.length - 1]?.payload?.message === "string"
        ? String(criticFlags[criticFlags.length - 1]?.payload?.message)
        : statusInfo.meaning;
    steps.push({
      step: "3. Critic Audit",
      actor: "Critic",
      detail: flagMsg,
      tone: "warning",
    });
  } else {
    steps.push({
      step: "3. Current Standing",
      actor: "Workbench",
      detail: statusInfo.meaning,
      tone: "neutral",
    });
  }

  return {
    kindInfo,
    statusInfo,
    steps,
    upstream,
    downstream,
  };
}
