import type { ReactNode } from "react";
import {
  parseProse,
  shortNodeKey,
  type ProseBlock,
  type ProseInline,
  type ProseSection,
} from "@/lib/ui/prose";
import type { DigressionNode } from "@/schemas/digression";

type CiteContext = {
  nodes?: DigressionNode[];
  onOpenNode?: (id: string) => void;
};

function resolveNode(
  ref: string,
  nodes?: DigressionNode[],
): DigressionNode | undefined {
  if (!nodes || nodes.length === 0) return undefined;
  const key = shortNodeKey(ref).toLowerCase();
  return nodes.find(
    (node) =>
      node.id === ref ||
      node.id.toLowerCase() === key ||
      node.id.toLowerCase().endsWith(`_${key}`),
  );
}

function renderInline(
  parts: ProseInline[],
  keyPrefix: string,
  ctx: CiteContext,
): ReactNode[] {
  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (part.kind === "strong") return <strong key={key}>{part.text}</strong>;
    if (part.kind === "em") return <em key={key}>{part.text}</em>;
    if (part.kind === "code") return <code key={key}>{part.text}</code>;
    if (part.kind === "cite") {
      const matched = resolveNode(part.ref, ctx.nodes);
      const label = matched
        ? `${shortNodeKey(matched.id)} · ${matched.title.slice(0, 24)}${matched.title.length > 24 ? "…" : ""}`
        : shortNodeKey(part.ref);
      if (matched && ctx.onOpenNode) {
        return (
          <button
            key={key}
            type="button"
            className="node-cite-pill is-interactive"
            onClick={() => ctx.onOpenNode?.(matched.id)}
            title={`Open node: ${matched.title} (${matched.status})`}
          >
            ↗ {label}
          </button>
        );
      }
      return (
        <span key={key} className="node-cite-pill">
          [{label}]
        </span>
      );
    }
    if (part.kind === "link") {
      return (
        <a key={key} href={part.href} target="_blank" rel="noreferrer">
          {part.text}
        </a>
      );
    }
    return <span key={key}>{part.text}</span>;
  });
}

function BlockView({
  block,
  id,
  ctx,
}: {
  block: ProseBlock;
  id: string;
  ctx: CiteContext;
}) {
  if (block.kind === "p") {
    return <p className="analysis-p">{renderInline(block.parts, id, ctx)}</p>;
  }
  const List = block.kind === "ol" ? "ol" : "ul";
  return (
    <List className="viz-list">
      {block.items.map((item, index) => (
        <li key={`${id}-${index}`}>
          {renderInline(item, `${id}-${index}`, ctx)}
        </li>
      ))}
    </List>
  );
}

function SectionView({
  section,
  index,
  ctx,
}: {
  section: ProseSection;
  index: number;
  ctx: CiteContext;
}) {
  const body = section.blocks.map((block, blockIndex) => (
    <BlockView
      key={`${index}-${blockIndex}`}
      block={block}
      id={`${index}-${blockIndex}`}
      ctx={ctx}
    />
  ));

  if (!section.title) {
    return <div className="analysis-prose">{body}</div>;
  }

  return (
    <section className={`viz-section tone-${section.tone}`}>
      <p className="viz-kicker">{section.title}</p>
      <div className="viz-section-body">{body}</div>
    </section>
  );
}

export function AnalysisBody({
  text,
  nodes,
  onOpenNode,
}: {
  text: string;
  nodes?: DigressionNode[];
  onOpenNode?: (id: string) => void;
}) {
  const sections = parseProse(text);
  const ctx: CiteContext = { nodes, onOpenNode };
  return (
    <div className="analysis-visual">
      {sections.map((section, index) => (
        <SectionView
          key={`${section.title ?? "body"}-${index}`}
          section={section}
          index={index}
          ctx={ctx}
        />
      ))}
    </div>
  );
}
