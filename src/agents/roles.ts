/**
 * 9-Role Econometric & Digression Crew in PoliNote:
 * 1. scoper — Scope Contract, policy date, treatment/control candidates, and hypothesis
 * 2. data_scout — Live series search across providers & metadata validation report
 * 3. identification_strategist — Selects method from catalog, states assumptions & threats
 * 4. econometrician — Writes the estimation specification only (code executes it)
 * 5. literature_analyst — Pulls cited prior estimates with verbatim quote spans
 * 6. skeptic — Red-team critique (confounders, reverse causality, "what would change my mind" forks)
 * 7. data_auditor — Deterministic code numeric auditor (never an LLM)
 * 8. synthesizer — Writes argument referencing only verified IDs, honesty labels, and CIs
 * 9. trace_narrator — Plain-language provenance walkthrough
 */

export const PRIMARY_CREW_ROLES = [
  "scoper",
  "data_scout",
  "identification_strategist",
  "econometrician",
  "literature_analyst",
  "skeptic",
  "data_auditor",
  "synthesizer",
  "trace_narrator",
] as const;

export const LEGACY_CREW_ROLES = [
  "instrument_parser",
  "literature",
  "series",
  "legal",
  "macro",
  "incidence",
  "critic",
] as const;

export const CREW_ROLES = [
  ...PRIMARY_CREW_ROLES,
  ...LEGACY_CREW_ROLES,
] as const;

export type PrimaryCrewRole = (typeof PRIMARY_CREW_ROLES)[number];
export type CrewRole = (typeof CREW_ROLES)[number];
