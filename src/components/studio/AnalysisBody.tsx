import type { ReactNode } from "react";

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={`${keyPrefix}-${index}`}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

export function AnalysisBody({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const content = paragraph.join(" ");
    blocks.push(
      <p key={`p-${blocks.length}`} className="analysis-p">
        {renderInline(content, `p-${blocks.length}`)}
      </p>,
    );
    paragraph = [];
  };

  const flushList = () => {
    if (list.length === 0) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="analysis-list">
        {list.map((item, index) => (
          <li key={index}>{renderInline(item, `li-${blocks.length}-${index}`)}</li>
        ))}
      </ul>,
    );
    list = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushList();
      flushParagraph();
      continue;
    }
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      flushList();
      flushParagraph();
      blocks.push(
        <h3 key={`h-${blocks.length}`} className="analysis-h">
          {heading[1]}
        </h3>,
      );
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      list.push(bullet[1]);
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushList();
  flushParagraph();

  return <div className="analysis-prose">{blocks}</div>;
}
