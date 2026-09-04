/**
 * Crew roles with hard mutation walls in src/agents/walls.ts.
 * Live runner is sequential in src/lib/ai/crew.ts:
 * scoper → instrument_parser → literature → MCP specialists → critic → synthesizer → trace.
 */

export const CREW_ROLES = [
  "scoper",
  "instrument_parser",
  "literature",
  "series",
  "legal",
  "macro",
  "incidence",
  "critic",
  "synthesizer",
  "trace_narrator",
] as const;

export type CrewRole = (typeof CREW_ROLES)[number];
