"use client";

import type { RefObject } from "react";
import { ResponseCard } from "./ResponseCard";
import type { ThreadItem } from "./thread-types";
import { groupThreadTurns } from "@/lib/ui/thread-turns";
import type { RunEvent } from "@/schemas/run-event";

type ThreadProps = {
  items: ThreadItem[];
  events?: RunEvent[];
  onOpenNode: (id: string) => void;
  listRef: RefObject<HTMLDivElement | null>;
};

export function Thread({
  items,
  events = [],
  onOpenNode,
  listRef,
}: ThreadProps) {
  const turns = groupThreadTurns(items, events);

  return (
    <div
      ref={listRef}
      className="thread-scroll min-h-0 flex-1 overflow-y-auto"
      aria-live="polite"
    >
      <div className="flex flex-col gap-5 px-5 py-5">
        {turns.map((turn) => {
          const hasResponse =
            turn.items.length > 0 || turn.events.length > 0;
          return (
            <div key={turn.id} className="thread-turn">
              {turn.user ? (
                <div className="flex justify-end">
                  <p className="user-bubble max-w-[92%] text-[15px] leading-relaxed">
                    {turn.user.text}
                  </p>
                </div>
              ) : null}
              {hasResponse ? (
                <ResponseCard
                  items={turn.items}
                  events={turn.events}
                  finished={turn.finished}
                  onOpenNode={onOpenNode}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
