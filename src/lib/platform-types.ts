import type { NodeAnalysis } from "@/schemas/analysis";
import type { DigressionEdge, DigressionNode } from "@/schemas/digression";
import type { ScopeContract } from "@/schemas/scope-contract";
import type { ThreadItem } from "@/components/studio/thread-types";

export type RunSummary = {
  id: string;
  title: string;
  status: "draft" | "ready" | "running" | "paused" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
};

export type RunSnapshot = {
  run: RunSummary;
  items: ThreadItem[];
  nodes: DigressionNode[];
  edges: DigressionEdge[];
  scope: ScopeContract | null;
  analyses: Record<string, NodeAnalysis>;
};
