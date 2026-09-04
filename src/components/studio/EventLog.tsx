"use client";

import { eventLabel, eventNodeId, humanAgent } from "@/lib/ai/event-view";
import type { RunEvent } from "@/schemas/run-event";

type EventLogProps = {
  events: RunEvent[];
  onOpenNode?: (id: string) => void;
};

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function mcpCount(events: RunEvent[]): number {
  return events.filter(
    (event) => event.type === "mcp.tool_call" || event.type === "mcp.tool_result",
  ).length;
}

export function EventLog({ events, onOpenNode }: EventLogProps) {
  if (events.length === 0) return null;
  const tools = mcpCount(events);

  return (
    <details className="event-log">
      <summary className="event-log-summary">
        <span>Run record</span>
        <span className="event-log-count">
          {events.length}
          {tools > 0 ? ` · ${tools} MCP` : ""}
        </span>
      </summary>
      <ol className="event-log-list">
        {events.map((event) => {
          const nodeId = eventNodeId(event);
          const label = eventLabel(event);
          const meta = [
            event.type,
            event.agent ? humanAgent(event.agent) : null,
            formatTime(event.ts),
          ]
            .filter(Boolean)
            .join(" · ");

          if (nodeId && onOpenNode) {
            return (
              <li key={event.id}>
                <button
                  type="button"
                  className="event-log-row is-action"
                  onClick={() => onOpenNode(nodeId)}
                >
                  <span className="event-log-label">{label}</span>
                  <span className="event-log-meta">{meta} · open</span>
                </button>
              </li>
            );
          }

          return (
            <li key={event.id}>
              <div className="event-log-row">
                <span className="event-log-label">{label}</span>
                <span className="event-log-meta">{meta}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </details>
  );
}
