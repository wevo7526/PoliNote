import type {
  DigressionEdge,
  DigressionNode,
  DigressionNodeKind,
} from "@/schemas/digression";

export const SPINE_LANES = [
  "instrument",
  "mechanism",
  "claim",
  "identification",
  "incidence",
] as const;

export type SpineLane = (typeof SPINE_LANES)[number];
export type PolicyLane = SpineLane | "digression";

export const NODE_W = 260;
export const NODE_H = 60;
export const LANE_STEP = 300;
export const SPINE_START_Y = 52;
export const ROW_H = 100;
export const HEADER_Y = 22;
export const BAND_GAP = 28;
export const BAND_HEADER = 32;

export const LANE_X: Record<SpineLane, number> = {
  instrument: 40,
  mechanism: 40 + LANE_STEP,
  claim: 40 + LANE_STEP * 2,
  identification: 40 + LANE_STEP * 3,
  incidence: 40 + LANE_STEP * 4,
};

export const LANE_LABEL: Record<PolicyLane, string> = {
  instrument: "Instrument",
  mechanism: "Mechanism",
  claim: "Claim / target",
  identification: "Identification",
  incidence: "Incidence",
  digression: "Digressions",
};

const KIND_LANE: Record<DigressionNodeKind, PolicyLane> = {
  constraint: "instrument",
  mechanism: "mechanism",
  claim: "claim",
  evidence: "identification",
  incidence: "incidence",
  fork: "digression",
  counterfactual: "digression",
  uncertainty: "digression",
};

export type PolicyLayout = {
  nodes: DigressionNode[];
  laneOf: Map<string, PolicyLane>;
  spineBottom: number;
  bandTop: number;
  bandBottom: number;
};

export function nodeLane(kind: DigressionNodeKind): PolicyLane {
  return KIND_LANE[kind];
}

function byStableOrder(a: DigressionNode, b: DigressionNode): number {
  const time = a.createdAt.localeCompare(b.createdAt);
  return time !== 0 ? time : a.id.localeCompare(b.id);
}

function spineParentX(
  node: DigressionNode,
  edges: DigressionEdge[],
  laneOf: Map<string, PolicyLane>,
): number {
  for (const edge of edges) {
    const otherId =
      edge.sourceId === node.id
        ? edge.targetId
        : edge.targetId === node.id
          ? edge.sourceId
          : null;
    if (!otherId) continue;
    const otherLane = laneOf.get(otherId);
    if (otherLane && otherLane !== "digression") {
      return LANE_X[otherLane];
    }
  }
  return LANE_X.claim;
}

export function layoutPolicyGraph(
  nodes: DigressionNode[],
  edges: DigressionEdge[] = [],
): PolicyLayout {
  const laneOf = new Map<string, PolicyLane>();
  for (const node of nodes) {
    laneOf.set(node.id, nodeLane(node.kind));
  }

  const spine: Record<SpineLane, DigressionNode[]> = {
    instrument: [],
    mechanism: [],
    claim: [],
    identification: [],
    incidence: [],
  };
  const digressions: DigressionNode[] = [];
  for (const node of [...nodes].sort(byStableOrder)) {
    const lane = laneOf.get(node.id) ?? "claim";
    if (lane === "digression") digressions.push(node);
    else spine[lane].push(node);
  }

  const maxSpine = Math.max(1, ...SPINE_LANES.map((lane) => spine[lane].length));
  const spineBottom = SPINE_START_Y + maxSpine * ROW_H;
  const bandTop = spineBottom + BAND_GAP;
  const bandBottom =
    bandTop + BAND_HEADER + Math.max(1, digressions.length) * ROW_H;

  const placed = new Map<string, DigressionNode>();
  for (const lane of SPINE_LANES) {
    spine[lane].forEach((node, index) => {
      placed.set(node.id, {
        ...node,
        position: { x: LANE_X[lane], y: SPINE_START_Y + index * ROW_H },
      });
    });
  }
  digressions.forEach((node, index) => {
    placed.set(node.id, {
      ...node,
      position: {
        x: spineParentX(node, edges, laneOf),
        y: bandTop + BAND_HEADER + index * ROW_H,
      },
    });
  });

  return {
    nodes: nodes.map((node) => placed.get(node.id) ?? node),
    laneOf,
    spineBottom,
    bandTop,
    bandBottom,
  };
}

export function layoutNodes(
  nodes: DigressionNode[],
  edges: DigressionEdge[] = [],
): DigressionNode[] {
  return layoutPolicyGraph(nodes, edges).nodes;
}
