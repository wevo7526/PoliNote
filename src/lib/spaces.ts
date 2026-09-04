export const SPACES = [
  {
    href: "/app/run",
    id: "run",
    label: "Run",
    blurb: "Talk to the crew. The digression graph is written here.",
  },
  {
    href: "/app/scope",
    id: "scope",
    label: "Scope",
    blurb: "Lock instrument, target, identification, and horizon.",
  },
  {
    href: "/app/map",
    id: "map",
    label: "Map",
    blurb: "The argument as a graph — claims, mechanisms, forks.",
  },
  {
    href: "/app/sources",
    id: "sources",
    label: "Sources",
    blurb: "Evidence leads, citations, and provenance for this run.",
  },
  {
    href: "/app/draft",
    id: "draft",
    label: "Draft",
    blurb: "Public brief and technical appendix from surviving nodes.",
  },
] as const;

export type SpaceId = (typeof SPACES)[number]["id"];
