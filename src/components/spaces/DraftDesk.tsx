"use client";

import { NeedRun } from "@/components/app/NeedRun";
import { useWorkspace } from "@/components/app/WorkspaceProvider";

function buildBrief(title: string, question: string, nodeLines: string[]): string {
  return [
    `# ${title}`,
    "",
    question,
    "",
    "## Claims",
    "",
    ...nodeLines,
    "",
    "_Every line above is grounded in a node ID. Ungrounded sentences will be flagged when the synthesizer is live._",
    "",
  ].join("\n");
}

export function DraftDesk() {
  const { snapshot, activeId } = useWorkspace();

  if (!activeId || !snapshot) {
    return (
      <main className="space-page">
        <NeedRun label="Draft" />
      </main>
    );
  }

  const claims = snapshot.nodes.filter((node) => node.kind === "claim" || node.kind === "incidence");
  const rest = snapshot.nodes.filter((node) => node.kind !== "claim" && node.kind !== "incidence");
  const brief = buildBrief(
    snapshot.run.title,
    snapshot.scope?.question ?? "No question locked yet.",
    (claims.length > 0 ? claims : snapshot.nodes).map(
      (node) => `- ${node.title} \`[${node.id}]\` — ${node.body}`,
    ),
  );
  const appendix = rest
    .map((node) => {
      const analysis = snapshot.analyses[node.id];
      return `### ${node.kind}: ${node.title}\n\n${analysis?.body ?? node.body}\n\n\`${node.id}\``;
    })
    .join("\n\n");

  return (
    <main className="space-page">
      <section className="work-frame overflow-y-auto">
        <header className="border-b border-[var(--line)] px-5 py-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--copper)]">
            Draft
          </p>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-xl">
            Brief and appendix
          </h1>
          <p className="mt-2 max-w-xl text-sm text-[var(--muted)]">
            Assembled from surviving nodes on this run. The synthesizer will
            later refuse sentences that do not cite a node ID.
          </p>
        </header>

        <div className="grid gap-4 p-5 lg:grid-cols-2">
          <article className="draft-col">
            <h2 className="text-[10px] uppercase tracking-[0.14em] text-[var(--copper)]">
              Public brief
            </h2>
            <pre className="draft-pre">{brief}</pre>
          </article>
          <article className="draft-col">
            <h2 className="text-[10px] uppercase tracking-[0.14em] text-[var(--copper)]">
              Technical appendix
            </h2>
            <pre className="draft-pre">
              {appendix || "Appendix fills as mechanisms, constraints, and forks appear."}
            </pre>
          </article>
        </div>
      </section>
    </main>
  );
}
