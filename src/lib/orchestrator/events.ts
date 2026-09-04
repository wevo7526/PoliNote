import type { DigressionEdge, DigressionNode } from "@/schemas/digression";
import type { ScopeContract } from "@/schemas/scope-contract";

export type StudioNarration = {
  kind: "narration";
  agent: string;
  text: string;
};

export type StudioScopeEvent = {
  kind: "scope";
  contract: ScopeContract;
};

export type StudioNodeEvent = {
  kind: "node";
  node: DigressionNode;
};

export type StudioEdgeEvent = {
  kind: "edge";
  edge: DigressionEdge;
};

export type StudioStatusEvent = {
  kind: "status";
  text: string;
};

export type StudioDoneEvent = {
  kind: "done";
};

export type StudioOrchestratorEvent =
  | StudioNarration
  | StudioScopeEvent
  | StudioNodeEvent
  | StudioEdgeEvent
  | StudioStatusEvent
  | StudioDoneEvent;
