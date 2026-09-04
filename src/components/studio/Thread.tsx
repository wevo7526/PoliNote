"use client";

import type { RefObject } from "react";
import { ScopeCard } from "./ScopeCard";
import { NodeCard } from "./NodeCard";
import type { ThreadItem } from "./thread-types";

type ThreadProps = {
  items: ThreadItem[];
  onOpenNode: (id: string) => void;
  listRef: RefObject<HTMLDivElement | null>;
};

export function Thread({ items, onOpenNode, listRef }: ThreadProps) {
  return (
    <div
      ref={listRef}
      className="thread-scroll min-h-0 flex-1 overflow-y-auto"
      aria-live="polite"
    >
      <div className="flex flex-col gap-4 px-5 py-5">
        {items.map((item) => {
          if (item.kind === "user") {
            return (
              <div key={item.id} className="flex justify-end">
                <p className="user-bubble max-w-[92%] text-[15px] leading-relaxed">{item.text}</p>
              </div>
            );
          }
          if (item.kind === "narration") {
            return (
              <div key={item.id} className="narration-box">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--copper)]">
                  {item.agent}
                </p>
                <p className="mt-1.5 text-[15px] leading-[1.65] text-[var(--ink)]/92">{item.text}</p>
              </div>
            );
          }
          if (item.kind === "status") {
            return (
              <p
                key={item.id}
                className="status-box text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]"
              >
                {item.text}
              </p>
            );
          }
          if (item.kind === "scope") {
            return <ScopeCard key={item.id} contract={item.contract} />;
          }
          return <NodeCard key={item.id} node={item.node} onOpen={onOpenNode} />;
        })}
      </div>
    </div>
  );
}
