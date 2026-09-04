import type { ThreadItem, UserItem } from "@/components/studio/thread-types";
import type { RunEvent } from "@/schemas/run-event";

export type ThreadTurn = {
  id: string;
  user: UserItem | null;
  items: ThreadItem[];
  events: RunEvent[];
  finished: boolean;
};

function bucketEvents(events: RunEvent[]): RunEvent[][] {
  const buckets: RunEvent[][] = [];
  let current: RunEvent[] = [];
  for (const event of events) {
    if (event.type === "run.created") continue;
    if (event.type === "run.started" && current.length > 0) {
      buckets.push(current);
      current = [event];
      continue;
    }
    current.push(event);
  }
  if (current.length > 0) buckets.push(current);
  return buckets;
}

export function groupThreadTurns(
  items: ThreadItem[],
  events: RunEvent[],
): ThreadTurn[] {
  const turns: ThreadTurn[] = [];
  let current: ThreadTurn | null = null;

  const open = (user: UserItem | null): ThreadTurn => {
    if (current) turns.push(current);
    current = {
      id: user?.id ?? `turn-${turns.length}`,
      user,
      items: [],
      events: [],
      finished: true,
    };
    return current;
  };

  for (const item of items) {
    if (item.kind === "user") {
      open(item);
      continue;
    }
    const turn = current ?? open(null);
    turn.items.push(item);
    if (item.id === "crew-working") turn.finished = false;
  }
  if (current) turns.push(current);

  const buckets = bucketEvents(events);
  if (turns.length === 0 && buckets.length > 0) {
    return buckets.map((bucket, index) => ({
      id: `events-${index}`,
      user: null,
      items: [],
      events: bucket,
      finished: true,
    }));
  }

  for (const [index, turn] of turns.entries()) {
    if (index < buckets.length) {
      turn.events = buckets[index] ?? [];
    }
  }
  if (buckets.length > turns.length) {
    const last = turns[turns.length - 1];
    if (last) {
      last.events = [...last.events, ...buckets.slice(turns.length).flat()];
    }
  }

  return turns;
}
