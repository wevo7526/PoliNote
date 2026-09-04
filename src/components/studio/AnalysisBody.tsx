import type { ReactNode } from "react";
import {
  parseProse,
  type ProseBlock,
  type ProseInline,
  type ProseSection,
} from "@/lib/ui/prose";

function renderInline(parts: ProseInline[], keyPrefix: string): ReactNode[] {
  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (part.kind === "strong") return <strong key={key}>{part.text}</strong>;
    if (part.kind === "em") return <em key={key}>{part.text}</em>;
    if (part.kind === "code") return <code key={key}>{part.text}</code>;
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

function BlockView({ block, id }: { block: ProseBlock; id: string }) {
  if (block.kind === "p") {
    return <p className="analysis-p">{renderInline(block.parts, id)}</p>;
  }
  const List = block.kind === "ol" ? "ol" : "ul";
  return (
    <List className="viz-list">
      {block.items.map((item, index) => (
        <li key={`${id}-${index}`}>{renderInline(item, `${id}-${index}`)}</li>
      ))}
    </List>
  );
}

function SectionView({ section, index }: { section: ProseSection; index: number }) {
  const body = section.blocks.map((block, blockIndex) => (
    <BlockView key={`${index}-${blockIndex}`} block={block} id={`${index}-${blockIndex}`} />
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

export function AnalysisBody({ text }: { text: string }) {
  const sections = parseProse(text);
  return (
    <div className="analysis-visual">
      {sections.map((section, index) => (
        <SectionView key={`${section.title ?? "body"}-${index}`} section={section} index={index} />
      ))}
    </div>
  );
}
