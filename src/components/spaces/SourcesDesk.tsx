"use client";

import { NeedRun } from "@/components/app/NeedRun";
import { useWorkspace } from "@/components/app/WorkspaceProvider";

export function SourcesDesk() {
  const { snapshot, activeId } = useWorkspace();

  if (!activeId) {
    return (
      <main className="space-page">
        <NeedRun label="Sources" />
      </main>
    );
  }

  const spans = (snapshot?.nodes ?? []).flatMap((node) =>
    node.provenance
      .filter((chip) => chip.spanId)
      .map((chip) => ({
        ...chip,
        nodeTitle: node.title,
        nodeId: node.id,
        status: node.status,
      })),
  );
  const citations = Object.values(snapshot?.analyses ?? {}).flatMap((analysis) =>
    analysis.citations.map((citation) => ({
      ...citation,
      nodeId: analysis.nodeId,
      analysisTitle: analysis.title,
    })),
  );
  const webProvenance = (snapshot?.nodes ?? []).flatMap((node) =>
    node.provenance
      .filter((chip) => !chip.spanId)
      .map((chip) => ({
        ...chip,
        nodeTitle: node.title,
      })),
  );

  return (
    <main className="space-page">
      <section className="work-frame overflow-y-auto">
        <header className="border-b border-[var(--line)] px-5 py-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--copper)]">
            Sources
          </p>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-xl">
            Evidence locker
          </h1>
          <p className="mt-2 max-w-xl text-sm text-[var(--muted)]">
            MCP spans can move a node to supported. Web leads stay informational.
          </p>
        </header>

        <div className="grid gap-3 p-5">
          {spans.length === 0 && citations.length === 0 && webProvenance.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              No sources yet. After a Run turn, MCP spans and citations land here.
            </p>
          ) : null}

          {spans.map((span, index) => (
            <article key={`${span.spanId}-${index}`} className="source-card">
              <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--copper)]">
                MCP span · {span.source} · {span.nodeTitle}
                {span.status === "supported" ? " · supported" : ""}
              </p>
              <h2 className="mt-1 font-[family-name:var(--font-display)] text-lg">
                {span.url ? (
                  <a
                    href={span.url}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-[var(--copper)]"
                  >
                    {span.label}
                  </a>
                ) : (
                  span.label
                )}
              </h2>
              <p className="mt-2 font-mono text-[11px] text-[var(--muted)]">{span.spanId}</p>
            </article>
          ))}

          {citations.map((citation, index) => (
            <article key={`${citation.url ?? citation.title}-${index}`} className="source-card">
              <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--copper)]">
                Lead · {citation.analysisTitle}
              </p>
              <h2 className="mt-1 font-[family-name:var(--font-display)] text-lg">
                {citation.url ? (
                  <a
                    href={citation.url}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-[var(--copper)]"
                  >
                    {citation.title}
                  </a>
                ) : (
                  citation.title
                )}
              </h2>
              {citation.note ? (
                <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
                  {citation.note}
                </p>
              ) : null}
            </article>
          ))}

          {webProvenance.map((chip, index) => (
            <article key={`${chip.label}-${index}`} className="source-card">
              <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">
                {chip.source} · {chip.nodeTitle}
              </p>
              <h2 className="mt-1 text-[15px]">{chip.label}</h2>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
