export type ProseInline =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "em"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

export type ProseBlock =
  | { kind: "p"; parts: ProseInline[] }
  | { kind: "ul"; items: ProseInline[][] }
  | { kind: "ol"; items: ProseInline[][] };

export type ProseSection = {
  title: string | null;
  tone: SectionTone;
  blocks: ProseBlock[];
};

export type SectionTone =
  | "mechanism"
  | "incidence"
  | "identification"
  | "signflip"
  | "missing"
  | "claims"
  | "scope"
  | "generic";

const TONE_BY_TITLE: Record<string, SectionTone> = {
  mechanism: "mechanism",
  incidence: "incidence",
  identification: "identification",
  "sign flip": "signflip",
  "missing evidence": "missing",
  claims: "claims",
  scope: "scope",
  risk: "signflip",
  critic: "signflip",
};

const BARE_HEADING =
  /^(mechanism|incidence|identification|sign flip|missing evidence|claims|scope|risk|critic)$/i;

function cleanHeading(value: string): string {
  return value.replace(/[*#_:`]+/g, "").replace(/\s+/g, " ").trim();
}

function toneFor(title: string | null): SectionTone {
  if (!title) return "generic";
  return TONE_BY_TITLE[title.toLowerCase()] ?? "generic";
}

function headingFrom(line: string): string | null {
  const hash = line.match(/^#{1,6}\s*(.+)$/);
  if (hash) return cleanHeading(hash[1] ?? "") || null;
  const bold = line.match(/^\*\*(.+?)\*\*:?$/);
  if (bold && (bold[1] ?? "").length <= 48) return cleanHeading(bold[1] ?? "") || null;
  const labeled = line.match(/^([A-Za-z][A-Za-z ]{1,40}):$/);
  if (labeled) return cleanHeading(labeled[1] ?? "") || null;
  if (BARE_HEADING.test(line)) return cleanHeading(line);
  return null;
}

export function parseInline(text: string): ProseInline[] {
  const parts: ProseInline[] = [];
  const pattern =
    /(\*\*[^*]+?\*\*|__[^_]+?__|`[^`]+?`|\[[^\]]+?\]\([^)]+?\)|\*[^*\n]+?\*)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > cursor) {
      parts.push({ kind: "text", text: text.slice(cursor, match.index) });
    }
    const token = match[0];
    if (token.startsWith("**") || token.startsWith("__")) {
      parts.push({ kind: "strong", text: token.slice(2, -2) });
    } else if (token.startsWith("`")) {
      parts.push({ kind: "code", text: token.slice(1, -1) });
    } else if (token.startsWith("[")) {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (link) parts.push({ kind: "link", text: link[1] ?? "", href: link[2] ?? "" });
    } else if (token.startsWith("*")) {
      parts.push({ kind: "em", text: token.slice(1, -1) });
    }
    cursor = match.index + token.length;
  }
  if (cursor < text.length) {
    parts.push({ kind: "text", text: text.slice(cursor) });
  }
  return parts
    .map((part) =>
      part.kind === "link" || part.kind === "code"
        ? part
        : { ...part, text: part.text.replace(/\*\*/g, "").replace(/__/g, "") },
    )
    .filter((part) => part.text.length > 0);
}

function unwrapFences(text: string): string {
  return text.replace(/```[\w-]*\n?([\s\S]*?)```/g, "$1").replace(/\r\n/g, "\n");
}

export function parseProse(text: string): ProseSection[] {
  const lines = unwrapFences(text).split("\n");
  const sections: ProseSection[] = [];
  let title: string | null = null;
  let blocks: ProseBlock[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: "p", parts: parseInline(paragraph.join(" ")) });
    paragraph = [];
  };

  const flushList = () => {
    if (!list) return;
    blocks.push({
      kind: list.ordered ? "ol" : "ul",
      items: list.items.map(parseInline),
    });
    list = null;
  };

  const flushSection = () => {
    flushList();
    flushParagraph();
    if (title || blocks.length > 0) {
      sections.push({ title, tone: toneFor(title), blocks });
    }
    title = null;
    blocks = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || /^[-_*]{3,}$/.test(line)) {
      flushList();
      flushParagraph();
      continue;
    }
    const heading = headingFrom(line);
    if (heading) {
      flushSection();
      title = heading;
      continue;
    }
    const ol = line.match(/^\d+[.)]\s+(.+)$/);
    if (ol) {
      flushParagraph();
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(ol[1] ?? "");
      continue;
    }
    const ul = line.match(/^[-*•]\s+(.+)$/);
    if (ul) {
      flushParagraph();
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(ul[1] ?? "");
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushSection();
  return sections.length > 0 ? sections : [{ title: null, tone: "generic", blocks: [] }];
}
