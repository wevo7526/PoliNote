import { fredProvider } from "./fred";
import { listDataProviders } from "./providers";
import {
  DataUnavailableError,
  type DataProviderId,
  type SeriesMetadata,
} from "./types";

export type CandidateValidationResult = {
  metadata: SeriesMetadata;
  accepted: boolean;
  score: number;
  reasons: string[];
  rejectionReasons: string[];
};

export type SeriesSelectionReport = {
  query: string;
  derivedWindow: {
    policyDate: string | null;
    observationStart: string;
    observationEnd: string;
    rationale: string;
  };
  selected: CandidateValidationResult[];
  rejected: CandidateValidationResult[];
  providerErrors: Array<{ provider: DataProviderId; message: string }>;
};

const STOP_WORDS = new Set([
  "what",
  "are",
  "the",
  "near",
  "term",
  "effects",
  "effect",
  "from",
  "with",
  "into",
  "under",
  "this",
  "that",
  "how",
  "does",
  "would",
  "could",
  "should",
  "policy",
  "question",
  "evaluate",
  "assess",
  "digress",
  "analysis",
  "impact",
  "impacts",
  "did",
  "increase",
  "decrease",
  "affect",
  "act",
  "and",
  "for",
]);

/**
 * Derives observation_start and observation_end from the explicit Scope Contract policyDate
 * or explicit dates in the text.
 * Rule: at least 6 years pre-policy through the latest available date.
 * Never uses "last N points" or hard-coded topic pins.
 */
export function deriveObservationWindow(input: {
  question: string;
  horizon?: string;
  policyDate?: string | null;
}): {
  policyDate: string | null;
  observationStart: string;
  observationEnd: string;
  rationale: string;
} {
  const currentYear = new Date().getFullYear();
  const todayIso = new Date().toISOString().slice(0, 10);

  if (input.policyDate && /^\d{4}-\d{2}-\d{2}$/.test(input.policyDate.trim())) {
    const cleanDate = input.policyDate.trim();
    const y = Number.parseInt(cleanDate.slice(0, 4), 10);
    const startYear = Math.min(y - 6, currentYear - 10);
    return {
      policyDate: cleanDate,
      observationStart: `${startYear}-01-01`,
      observationEnd: todayIso,
      rationale: `6 years pre-policy (${startYear}-01-01) around Scope policy date ${cleanDate} through latest available (${todayIso}).`,
    };
  }

  const combined = `${input.horizon ?? ""} ${input.question}`;
  const isoDateMatch = combined.match(/\b(19[7-9]\d|20[0-2]\d)-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/);
  if (isoDateMatch?.[0]) {
    const cleanDate = isoDateMatch[0];
    const y = Number.parseInt(cleanDate.slice(0, 4), 10);
    const startYear = Math.min(y - 6, currentYear - 10);
    return {
      policyDate: cleanDate,
      observationStart: `${startYear}-01-01`,
      observationEnd: todayIso,
      rationale: `6 years pre-policy (${startYear}-01-01) around explicit date ${cleanDate} through latest available (${todayIso}).`,
    };
  }

  const yearMatches = [...combined.matchAll(/\b(19[7-9]\d|20[0-2]\d)\b/g)]
    .map((m) => Number.parseInt(m[1]!, 10))
    .filter((y) => y >= 1970 && y <= currentYear);

  if (yearMatches.length > 0) {
    const policyYear = Math.min(...yearMatches);
    const startYear = Math.min(policyYear - 6, currentYear - 10);
    const policyDate = `${policyYear}-01-01`;
    return {
      policyDate,
      observationStart: `${startYear}-01-01`,
      observationEnd: todayIso,
      rationale: `At least 6 years pre-policy (${startYear}-01-01, policy date ${policyDate}) through latest available date (${todayIso}).`,
    };
  }

  const defaultStartYear = currentYear - 12;
  return {
    policyDate: null,
    observationStart: `${defaultStartYear}-01-01`,
    observationEnd: todayIso,
    rationale: `No explicit policy date found; using 12-year empirical window (${defaultStartYear}-01-01 through ${todayIso}).`,
  };
}

/**
 * Tokenizes raw text into a provider search query without any hardcoded topic rewrites.
 */
export function buildProviderSearchQuery(rawText: string): string {
  const tokens = rawText
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !STOP_WORDS.has(w));
  const unique = tokens.filter((w, i) => tokens.indexOf(w) === i);
  return unique.slice(0, 6).join(" ") || rawText.trim().slice(0, 60);
}

/**
 * Deterministic code validation of a candidate series against scope window & quality rules.
 */
export function validateCandidateMetadata(
  meta: SeriesMetadata,
  window: { observationStart: string; policyDate: string | null },
): CandidateValidationResult {
  const reasons: string[] = [];
  const rejectionReasons: string[] = [];
  let score = meta.popularity ?? 40;

  if (meta.discontinued) {
    rejectionReasons.push("Series is marked DISCONTINUED by provider.");
  } else {
    reasons.push("Active (non-discontinued) series.");
  }

  if (meta.observationEnd) {
    const endYear = Number.parseInt(meta.observationEnd.slice(0, 4), 10);
    const minEndYear = window.policyDate
      ? Number.parseInt(window.policyDate.slice(0, 4), 10) + 1
      : new Date().getFullYear() - 3;
    if (Number.isFinite(endYear) && endYear < minEndYear) {
      rejectionReasons.push(
        `Observation coverage ends too early (${meta.observationEnd}, needs post-policy coverage >= ${minEndYear}).`,
      );
    } else {
      reasons.push(`Covers through ${meta.observationEnd}.`);
    }
  }

  if (meta.observationStart && window.policyDate) {
    const startYear = Number.parseInt(meta.observationStart.slice(0, 4), 10);
    const policyYear = Number.parseInt(window.policyDate.slice(0, 4), 10);
    if (Number.isFinite(startYear) && startYear > policyYear - 3) {
      rejectionReasons.push(
        `Insufficient pre-policy window (starts ${meta.observationStart}, policy ${window.policyDate}).`,
      );
    } else {
      reasons.push(`Pre-policy history starts ${meta.observationStart}.`);
    }
  }

  if (
    /seasonally adjusted/i.test(meta.seasonalAdjustment) &&
    !/not seasonally/i.test(meta.seasonalAdjustment)
  ) {
    score += 15;
    reasons.push(
      `Seasonally adjusted (${meta.seasonalAdjustmentShort || meta.seasonalAdjustment}).`,
    );
  }

  if (meta.frequencyShort === "m" || meta.frequencyShort === "q") {
    score += 12;
    reasons.push(`High-utility econometric frequency (${meta.frequency}).`);
  }

  if (meta.copyrightedThirdParty) {
    reasons.push("Flagged: third-party copyright notice in series metadata.");
  }

  return {
    metadata: meta,
    accepted: rejectionReasons.length === 0,
    score,
    reasons,
    rejectionReasons,
  };
}

/**
 * Searches live data providers, validates every candidate against metadata rules,
 * and returns both selected and rejected candidates with transparent reasons.
 */
export async function selectAndValidateLiveSeries(input: {
  question: string;
  horizon?: string;
  policyDate?: string | null;
  extraQueries?: string[];
  proposedSeriesIds?: string[];
  maxSelected?: number;
}): Promise<SeriesSelectionReport> {
  const derivedWindow = deriveObservationWindow({
    question: input.question,
    horizon: input.horizon,
    policyDate: input.policyDate,
  });

  const primaryQuery = buildProviderSearchQuery(input.question);
  const queries = [
    primaryQuery,
    ...(input.extraQueries ?? []).map(buildProviderSearchQuery),
  ].filter((q, i, arr) => q.length > 0 && arr.indexOf(q) === i);

  const providerErrors: Array<{ provider: DataProviderId; message: string }> = [];
  const rawCandidates: SeriesMetadata[] = [];

  // 1. Validate any explicit candidate series IDs proposed by Scoper / Data Scout against live provider metadata
  const proposed = (input.proposedSeriesIds ?? [])
    .map((s) => s.trim().toUpperCase())
    .filter((s, i, a) => /^[A-Z0-9_:-]{2,32}$/.test(s) && a.indexOf(s) === i);

  if (proposed.length > 0) {
    const metaResults = await Promise.all(
      proposed.slice(0, 5).map(async (id) => {
        try {
          return await fredProvider.metadata(id);
        } catch (error) {
          providerErrors.push({
            provider: "fred",
            message:
              error instanceof Error
                ? error.message
                : `Metadata lookup failed for ${id}`,
          });
          return null;
        }
      }),
    );
    for (const m of metaResults) {
      if (m) rawCandidates.push(m);
    }
  }

  // 2. If FRED_API_KEY is configured, also run catalog search queries
  if (fredProvider.isConfigured()) {
    const searchResults = await Promise.all(
      queries.slice(0, 2).map(async (q) => {
        try {
          return await fredProvider.search(q, 8);
        } catch (error) {
          const msg =
            error instanceof DataUnavailableError
              ? error.message
              : error instanceof Error
                ? error.message
                : "FRED search failed";
          providerErrors.push({ provider: "fred", message: msg });
          return [] as SeriesMetadata[];
        }
      }),
    );
    for (const batch of searchResults) {
      rawCandidates.push(...batch);
    }
  } else if (rawCandidates.length === 0) {
    providerErrors.push({
      provider: "fred",
      message: "Data unavailable: FRED — FRED_API_KEY is not configured for free-text catalog search",
    });
  }

  const wbProvider = listDataProviders().find((p) => p.id === "worldbank");
  if (
    wbProvider &&
    (rawCandidates.length === 0 ||
      /country|oecd|global|world|cbam|tariff/i.test(input.question))
  ) {
    try {
      const wbHits = await wbProvider.search(primaryQuery, 5);
      rawCandidates.push(...wbHits);
    } catch (error) {
      providerErrors.push({
        provider: "worldbank",
        message:
          error instanceof Error ? error.message : "World Bank search failed",
      });
    }
  }

  const deduped = new Map<string, SeriesMetadata>();
  for (const item of rawCandidates) {
    const key = `${item.provider}:${item.id}`;
    if (!deduped.has(key)) {
      deduped.set(key, item);
    }
  }

  const validated = [...deduped.values()].map((meta) =>
    validateCandidateMetadata(meta, derivedWindow),
  );

  const selected = validated
    .filter((v) => v.accepted)
    .sort((a, b) => b.score - a.score)
    .slice(0, input.maxSelected ?? 4);

  const rejected = [
    ...validated.filter((v) => !v.accepted),
    ...validated
      .filter((v) => v.accepted && !selected.includes(v))
      .map((v) => ({
        ...v,
        accepted: false,
        rejectionReasons: [
          `Ranked below top ${input.maxSelected ?? 4} candidates (score ${v.score}). Available for manual swap.`,
        ],
      })),
  ];

  return {
    query: queries.join(" | "),
    derivedWindow,
    selected,
    rejected,
    providerErrors,
  };
}
