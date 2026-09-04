import type { DigressionNode, DigressionNodeKind } from "@/schemas/digression";

const COLUMN_X: Record<DigressionNodeKind, number> = {
  mechanism: 40,
  evidence: 40,
  uncertainty: 40,
  claim: 400,
  constraint: 400,
  counterfactual: 400,
  incidence: 760,
  fork: 760,
};

export function layoutNodes(nodes: DigressionNode[]): DigressionNode[] {
  const counts: Partial<Record<number, number>> = {};
  return nodes.map((node) => {
    const x = COLUMN_X[node.kind];
    const row = counts[x] ?? 0;
    counts[x] = row + 1;
    return {
      ...node,
      position: { x, y: 36 + row * 120 },
    };
  });
}
