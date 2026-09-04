"use client";

import type { DigressionNode, UserNodeStatus } from "@/schemas/digression";

type NodeActionsProps = {
  node: DigressionNode;
  disabled?: boolean;
  onSetStatus: (nodeId: string, status: UserNodeStatus) => void;
};

export function NodeActions({ node, disabled = false, onSetStatus }: NodeActionsProps) {
  return (
    <div className="node-actions">
      {node.status !== "contested" ? (
        <button
          type="button"
          className="node-action"
          disabled={disabled}
          onClick={() => onSetStatus(node.id, "contested")}
        >
          Contest
        </button>
      ) : null}
      {node.status !== "pruned" ? (
        <button
          type="button"
          className="node-action"
          disabled={disabled}
          onClick={() => onSetStatus(node.id, "pruned")}
        >
          Prune
        </button>
      ) : null}
      {node.status === "pruned" || node.status === "contested" ? (
        <button
          type="button"
          className="node-action"
          disabled={disabled}
          onClick={() => onSetStatus(node.id, "proposed")}
        >
          Restore
        </button>
      ) : null}
    </div>
  );
}
