/**
 * LangGraph crew entry (phase: langgraph-crew).
 * Role-separated StateGraph: Scoper → Instrument → specialists → Critic → Synthesizer.
 * Checkpointed turns via Postgres — do not run full digressions in one serverless invoke.
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
