import type { CrewRole } from "@/agents/roles";
import type { DigressionNodeKind, DigressionNodeStatus } from "@/schemas/digression";

export type RoleAction =
  | { type: "write_scope" }
  | { type: "add_node"; kind: DigressionNodeKind }
  | { type: "update_node"; status?: DigressionNodeStatus; addPositiveClaim?: boolean }
  | { type: "attach_span" }
  | { type: "mark_supported" }
  | { type: "write_draft" }
  | { type: "flag" };

type RoleWall = {
  writeScope: boolean;
  addNodes: boolean;
  kinds: DigressionNodeKind[] | "*";
  updateNodes: boolean;
  addPositiveClaims: boolean;
  attachSpans: boolean;
  markSupported: boolean;
  writeDraft: boolean;
  flag: boolean;
};

const ALL_KINDS: DigressionNodeKind[] = [
  "claim",
  "mechanism",
  "constraint",
  "evidence",
  "counterfactual",
  "incidence",
  "uncertainty",
  "fork",
];

export const ROLE_WALLS: Record<CrewRole, RoleWall> = {
  scoper: {
    writeScope: true,
    addNodes: false,
    kinds: [],
    updateNodes: false,
    addPositiveClaims: false,
    attachSpans: false,
    markSupported: false,
    writeDraft: false,
    flag: false,
  },
  instrument_parser: {
    writeScope: false,
    addNodes: true,
    kinds: ["claim", "mechanism"],
    updateNodes: true,
    addPositiveClaims: true,
    attachSpans: false,
    markSupported: false,
    writeDraft: false,
    flag: false,
  },
  literature: {
    writeScope: false,
    addNodes: true,
    kinds: "*",
    updateNodes: true,
    addPositiveClaims: true,
    attachSpans: true,
    markSupported: true,
    writeDraft: false,
    flag: false,
  },
  series: {
    writeScope: false,
    addNodes: true,
    kinds: ["evidence"],
    updateNodes: true,
    addPositiveClaims: false,
    attachSpans: true,
    markSupported: true,
    writeDraft: false,
    flag: false,
  },
  legal: {
    writeScope: false,
    addNodes: true,
    kinds: ["constraint", "evidence"],
    updateNodes: true,
    addPositiveClaims: false,
    attachSpans: true,
    markSupported: true,
    writeDraft: false,
    flag: false,
  },
  macro: {
    writeScope: false,
    addNodes: true,
    kinds: ["evidence", "mechanism"],
    updateNodes: true,
    addPositiveClaims: false,
    attachSpans: true,
    markSupported: true,
    writeDraft: false,
    flag: false,
  },
  incidence: {
    writeScope: false,
    addNodes: true,
    kinds: ["incidence"],
    updateNodes: true,
    addPositiveClaims: true,
    attachSpans: false,
    markSupported: false,
    writeDraft: false,
    flag: false,
  },
  critic: {
    writeScope: false,
    addNodes: false,
    kinds: [],
    updateNodes: true,
    addPositiveClaims: false,
    attachSpans: false,
    markSupported: false,
    writeDraft: false,
    flag: true,
  },
  synthesizer: {
    writeScope: false,
    addNodes: false,
    kinds: [],
    updateNodes: false,
    addPositiveClaims: false,
    attachSpans: false,
    markSupported: false,
    writeDraft: true,
    flag: false,
  },
  trace_narrator: {
    writeScope: false,
    addNodes: false,
    kinds: [],
    updateNodes: false,
    addPositiveClaims: false,
    attachSpans: false,
    markSupported: false,
    writeDraft: false,
    flag: false,
  },
};

export function allowRoleAction(role: CrewRole, action: RoleAction): boolean {
  const wall = ROLE_WALLS[role];
  switch (action.type) {
    case "write_scope":
      return wall.writeScope;
    case "add_node":
      return (
        wall.addNodes &&
        (wall.kinds === "*" || wall.kinds.includes(action.kind))
      );
    case "update_node":
      if (!wall.updateNodes) return false;
      if (action.addPositiveClaim && !wall.addPositiveClaims) return false;
      if (action.status === "supported" && !wall.markSupported) return false;
      return true;
    case "attach_span":
      return wall.attachSpans;
    case "mark_supported":
      return wall.markSupported;
    case "write_draft":
      return wall.writeDraft;
    case "flag":
      return wall.flag;
    default:
      return false;
  }
}

export function roleKindList(role: CrewRole): DigressionNodeKind[] {
  const kinds = ROLE_WALLS[role].kinds;
  return kinds === "*" ? ALL_KINDS : kinds;
}
