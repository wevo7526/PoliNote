"use client";

import { eventLabel, humanAgent } from "@/lib/ai/event-view";
import type { RunEvent } from "@/schemas/run-event";

type GraphScrubberProps = {
  events: RunEvent[];
  scrubSeq: number | null;
  onChangeSeq: (seq: number | null) => void;
};

export function GraphScrubber({
  events,
  scrubSeq,
  onChangeSeq,
}: GraphScrubberProps) {
  if (events.length <= 1) return null;

  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  const maxIndex = sorted.length - 1;
  const activeIndex =
    scrubSeq === null
      ? maxIndex
      : Math.max(
          0,
          sorted.findIndex((ev) => ev.seq >= scrubSeq),
        );
  const currentEvent = sorted[activeIndex] ?? sorted[maxIndex]!;
  const isLive = scrubSeq === null || activeIndex === maxIndex;

  return (
    <div className="graph-scrubber">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--copper)]">
          Timeline
        </span>
        <button
          type="button"
          className="graph-tool-btn"
          disabled={activeIndex <= 0}
          onClick={() => {
            const prev = sorted[Math.max(0, activeIndex - 1)];
            if (prev) onChangeSeq(prev.seq);
          }}
          title="Step back one event"
        >
          ◂
        </button>
        <input
          type="range"
          min={0}
          max={maxIndex}
          value={activeIndex}
          onChange={(event) => {
            const idx = Number(event.target.value);
            if (idx >= maxIndex) {
              onChangeSeq(null);
            } else {
              const target = sorted[idx];
              if (target) onChangeSeq(target.seq);
            }
          }}
          className="scrubber-range"
          aria-label="Scrub run event history"
        />
        <button
          type="button"
          className="graph-tool-btn"
          disabled={isLive}
          onClick={() => {
            const next = sorted[Math.min(maxIndex, activeIndex + 1)];
            if (!next || activeIndex + 1 >= maxIndex) onChangeSeq(null);
            else onChangeSeq(next.seq);
          }}
          title="Step forward one event"
        >
          ▸
        </button>
        <button
          type="button"
          className={`graph-filter-pill ${isLive ? "is-active" : ""}`}
          onClick={() => onChangeSeq(null)}
        >
          {isLive ? "Live" : "Return to live"}
        </button>
      </div>

      <div className="flex min-w-0 items-center gap-2 text-[11px] text-[var(--muted)]">
        <span className="font-mono text-[10px] text-[var(--copper)]">
          #{activeIndex + 1}/{sorted.length}
        </span>
        {currentEvent.agent ? (
          <span className="uppercase tracking-[0.1em]">
            {humanAgent(currentEvent.agent)} ·
          </span>
        ) : null}
        <span className="truncate text-[var(--ink)]">
          {eventLabel(currentEvent)}
        </span>
      </div>
    </div>
  );
}
