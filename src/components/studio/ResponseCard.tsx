"use client";

import { AnalysisBody } from "@/components/studio/AnalysisBody";
import { EventLog } from "@/components/studio/EventLog";
import { eventNodeId, humanAgent } from "@/lib/ai/event-view";
import type { RunEvent } from "@/schemas/run-event";

const ROLE: Record<string, string> = {
  scoper: "Locks the contract before the graph may grow.",
  literature: "Places claims, mechanisms, and incidence on the map.",
  critic: "Attacks identification. Cannot add a positive claim.",
};

type ResponseCardProps = {
  agent: string;
  text: string;
  events: RunEvent[];
  onOpenNode: (id: string) => void;
};

export function ResponseCard({
  agent,
  text,
  events,
  onOpenNode,
}: ResponseCardProps) {
  const nodeEvents = events.filter((event) => eventNodeId(event));
  const seen = new Set<string>();
  const nodes: Array<{ id: string; title: string }> = [];
  for (const event of nodeEvents) {
    const id = eventNodeId(event);
    const title = (event.payload.node as { title?: string } | undefined)?.title;
    if (!id || seen.has(id) || !title) continue;
    seen.add(id);
    nodes.push({ id, title });
  }

  return (
    <article className="response-card">
      <header className="response-head">
        <p className="response-agent">{humanAgent(agent)}</p>
        {ROLE[agent] ? <p className="response-role">{ROLE[agent]}</p> : null}
      </header>
      <div className="response-body">
        <AnalysisBody text={text} />
      </div>
      {nodes.length > 0 ? (
        <div className="response-actions">
          <p className="response-actions-label">On the graph</p>
          <div className="response-actions-row">
            {nodes.map((node) => (
              <button
                key={node.id}
                type="button"
                className="response-node-btn"
                onClick={() => onOpenNode(node.id)}
              >
                {node.title}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <EventLog events={events} onOpenNode={onOpenNode} />
    </article>
  );
}
