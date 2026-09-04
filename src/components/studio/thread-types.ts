import type { DigressionNode } from "@/schemas/digression";
import type { ScopeContract } from "@/schemas/scope-contract";

export type UserItem = {
  id: string;
  kind: "user";
  text: string;
};

export type NarrationItem = {
  id: string;
  kind: "narration";
  agent: string;
  text: string;
};

export type ScopeItem = {
  id: string;
  kind: "scope";
  contract: ScopeContract;
};

export type NodeItem = {
  id: string;
  kind: "node";
  node: DigressionNode;
};

export type StatusItem = {
  id: string;
  kind: "status";
  text: string;
};

export type ThreadItem = UserItem | NarrationItem | ScopeItem | NodeItem | StatusItem;
