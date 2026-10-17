export const SPACES = [
  {
    href: "/app/run",
    id: "run",
    label: "Run & Graph",
    blurb: "Ask a question, watch the argument map grow, and trace how output was made.",
  },
  {
    href: "/app/draft",
    id: "draft",
    label: "Report & Export",
    blurb: "Compile AI reports with charts & figures and download as Word (.docx) or PDF.",
  },
  {
    href: "/app/map",
    id: "map",
    label: "Full Map",
    blurb: "Inspect, filter, contest, or branch the full knowledge graph.",
  },
  {
    href: "/app/sources",
    id: "sources",
    label: "Sources",
    blurb: "Verified FRED series, OpenAlex studies, and statutory spans.",
  },
  {
    href: "/app/scope",
    id: "scope",
    label: "Scope Protocol",
    blurb: "Edit instrument, target, identification, and horizon.",
  },
] as const;

export type SpaceId = (typeof SPACES)[number]["id"];
