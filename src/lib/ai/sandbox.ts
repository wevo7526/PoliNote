import { gateway, generateText, type LanguageModel } from "ai";
import { openai } from "@ai-sdk/openai";
import type { ExtractedSeries } from "@/components/studio/ReportCharts";
import { selectAndValidateLiveSeries } from "@/lib/data/selector";
import type { FetchedSeriesBundle } from "@/lib/data/types";
import {
  auditGeneratedProseNumbers,
  buildAllowedNumericRegistry,
} from "@/lib/economics/auditor";
import { executeEconometricEstimate } from "@/lib/economics/estimators";
import type { EconometricEstimate } from "@/lib/economics/schemas";
import { getObservations } from "@/lib/mcp/fred";
import { searchLiterature, type ExtractedLiteratureEstimate } from "@/lib/mcp/openalex";

export type SandboxPersona = {
  id: string;
  name: string;
  era: string;
  school: string;
  tagline: string;
  voicePrompt: string;
  sampleQuestion: string;
  perspectiveBanner: string;
};

export const SANDBOX_PERSONAS: SandboxPersona[] = [
  {
    id: "adam_smith",
    name: "Adam Smith",
    era: "1776 · Glasgow & Edinburgh",
    school: "Classical Political Economy",
    tagline: "Division of labor, natural liberty, and skepticism of mercantile privilege.",
    perspectiveBanner: "Simulated perspective · Classical Political Economy (1776)",
    voicePrompt:
      "Speak in the lucid, observant voice of Adam Smith (The Wealth of Nations). Contrast productive labor, the extent of the market, and natural liberty against mercantile tariffs and monopolies. Debate strictly over the actual econometric estimates and cited literature provided in the prompt; never introduce or invent any numbers of your own.",
    sampleQuestion:
      "You are Adam Smith: debate the tariff pass-through and domestic employment estimates in this run.",
  },
  {
    id: "keynes",
    name: "John Maynard Keynes",
    era: "1936 · Cambridge & Bloomsbury",
    school: "Macroeconomics of Effective Demand",
    tagline: "Animal spirits, liquidity preference, and public investment under uncertainty.",
    perspectiveBanner: "Simulated perspective · Effective Demand & Liquidity Preference (1936)",
    voicePrompt:
      "Speak in the incisive voice of John Maynard Keynes (The General Theory). Evaluate the run's actual estimates and cited literature through effective demand, the marginal efficiency of capital, and liquidity preference. Never introduce any unverified numbers.",
    sampleQuestion:
      "You are John Maynard Keynes: evaluate business investment and interest-rate sensitivity in this run.",
  },
  {
    id: "friedman",
    name: "Milton Friedman",
    era: "1963 · Chicago Workshop",
    school: "Monetarism & Price Theory",
    tagline: "Price signals, long and variable monetary lags, and incidence of distortionary taxes.",
    perspectiveBanner: "Simulated perspective · Price Theory & Monetarism (1963)",
    voicePrompt:
      "Speak in the empirical, debate-ready voice of Milton Friedman. Emphasize price signals, long and variable lags, and the unintended incidence of tariffs and subsidies using only the actual estimates and literature spans in the prompt. Never invent numbers.",
    sampleQuestion:
      "You are Milton Friedman: critique the incidence and specification robustness of these estimates.",
  },
  {
    id: "hamilton",
    name: "Alexander Hamilton",
    era: "1791 · Treasury Department",
    school: "American System & Public Credit",
    tagline: "Pecuniary bounties, strategic manufacturing, and deep sovereign credit markets.",
    perspectiveBanner: "Simulated perspective · Report on Manufactures (1791)",
    voicePrompt:
      "Speak in the state-building voice of Alexander Hamilton (1791 Report on Manufactures). Weigh targeted bounties vs. protective duties strictly against the actual econometric estimates and cited literature provided.",
    sampleQuestion:
      "You are Alexander Hamilton: compare investment tax credits against tariffs using the run's estimates.",
  },
  {
    id: "ostrom",
    name: "Elinor Ostrom",
    era: "1990 · Bloomington Workshop",
    school: "Polycentric Institutional Analysis",
    tagline: "Polycentric governance and local institutional rules over one-size-fits-all mandates.",
    perspectiveBanner: "Simulated perspective · Polycentric Institutions (1990)",
    voicePrompt:
      "Speak in the grounded institutionalist voice of Elinor Ostrom. Analyze the run's actual estimates and cited studies through polycentric governance, boundary rules, and local monitoring.",
    sampleQuestion:
      "You are Elinor Ostrom: how do local institutional rules shape the outcomes estimated in this run?",
  },
  {
    id: "volcker",
    name: "Paul Volcker",
    era: "1979 · Eccles Building",
    school: "Central Bank Credibility",
    tagline: "Anchoring inflation expectations requires discipline and institutional credibility.",
    perspectiveBanner: "Simulated perspective · Monetary Credibility (1979)",
    voicePrompt:
      "Speak in the plain-spoken voice of Paul Volcker. Focus on inflation expectations, real interest rates, and fiscal discipline, referencing only the actual estimates and cited literature provided.",
    sampleQuestion:
      "You are Paul Volcker: what do the estimated impulse responses imply for inflation credibility?",
  },
];

export function detectPersona(
  prompt: string,
  explicitPersonaId?: string,
): SandboxPersona {
  if (explicitPersonaId && explicitPersonaId !== "auto") {
    const found = SANDBOX_PERSONAS.find((p) => p.id === explicitPersonaId);
    if (found) return found;
  }
  const lower = prompt.toLowerCase();
  if (lower.includes("adam smith") || lower.includes("wealth of nations")) {
    return SANDBOX_PERSONAS[0]!;
  }
  if (lower.includes("keynes")) return SANDBOX_PERSONAS[1]!;
  if (lower.includes("friedman") || lower.includes("monetaris")) {
    return SANDBOX_PERSONAS[2]!;
  }
  if (lower.includes("hamilton")) return SANDBOX_PERSONAS[3]!;
  if (lower.includes("ostrom")) return SANDBOX_PERSONAS[4]!;
  if (lower.includes("volcker")) return SANDBOX_PERSONAS[5]!;

  const customMatch = prompt.match(
    /you are\s+([A-Z][a-zA-Z\s.-]{2,32}?)(?:[,.:]|tell|explain|what|how)/i,
  );
  if (customMatch?.[1]) {
    const customName = customMatch[1].trim();
    return {
      id: "custom",
      name: customName,
      era: "Simulated Historical Perspective",
      school: "Political Economy Sandbox",
      tagline: `Simulated perspective of ${customName} debating actual run estimates and cited literature.`,
      perspectiveBanner: `Simulated perspective · ${customName}`,
      voicePrompt: `Adopt the intellectual framework of ${customName}. Debate strictly over the actual econometric estimates and cited literature provided; never introduce or invent numbers.`,
      sampleQuestion: prompt,
    };
  }

  return SANDBOX_PERSONAS[0]!;
}

function hasSandboxAiCredentials(): boolean {
  return Boolean(
    process.env.OPENAI_API_KEY?.trim() ||
      process.env.AI_GATEWAY_API_KEY?.trim() ||
      process.env.VERCEL_OIDC_TOKEN?.trim(),
  );
}

function resolveSandboxAiModel(modelId: string): LanguageModel {
  const cleanId = modelId.replace(/^openai\//, "");
  if (process.env.OPENAI_API_KEY?.trim()) {
    return openai(cleanId);
  }
  return gateway(`openai/${cleanId}`);
}

/**
 * Queries live provider series and OpenAlex literature specifically relevant to the prompt.
 * ZERO fallback macro series, ZERO hardcoded numbers. If no live data is found or FRED_API_KEY
 * is missing, returns empty `charts: []` and an explicit `dataStatusMessage`.
 */
export async function fetchSandboxLiveEvidence(prompt: string): Promise<{
  charts: ExtractedSeries[];
  bundles: FetchedSeriesBundle[];
  estimates: EconometricEstimate[];
  literature: ExtractedLiteratureEstimate[];
  dataStatusMessage: string;
}> {
  const charts: ExtractedSeries[] = [];
  const bundles: FetchedSeriesBundle[] = [];
  const estimates: EconometricEstimate[] = [];
  let literature: ExtractedLiteratureEstimate[] = [];
  const errors: string[] = [];

  const [selectionRes, litRes] = await Promise.all([
    selectAndValidateLiveSeries({
      question: prompt,
      maxSelected: 2,
    }).catch((err) => {
      errors.push(err instanceof Error ? err.message : "Series search failed");
      return null;
    }),
    searchLiterature({ query: prompt }).catch(() => null),
  ]);

  if (litRes?.ok && litRes.data?.works) {
    literature = litRes.data.works;
  }

  if (selectionRes) {
    for (const err of selectionRes.providerErrors) {
      errors.push(err.message);
    }
    for (const cand of selectionRes.selected.slice(0, 2)) {
      const obsRes = await getObservations({
        seriesId: cand.metadata.id,
        question: prompt,
        observationStart: selectionRes.derivedWindow.observationStart,
        observationEnd: selectionRes.derivedWindow.observationEnd,
      });
      if (obsRes.ok && obsRes.data && obsRes.data.seriesPoints.length >= 10) {
        const d = obsRes.data;
        charts.push({
          key: d.seriesId,
          seriesId: d.seriesId,
          title: d.title,
          units: d.units,
          url: d.span.url,
          spanId: d.span.id,
          vintage: d.provenance.vintageDate,
          resultHash: d.snapshot.sha256,
          provenance: d.provenance,
          nodeTitle: `${d.seriesId} Live Series`,
          points: d.seriesPoints,
        });
        const bundle: FetchedSeriesBundle = {
          metadata: cand.metadata,
          observations: d.seriesPoints,
          provenance: d.provenance,
          snapshot: d.snapshot,
        };
        bundles.push(bundle);
        try {
          const est = executeEconometricEstimate({
            method: "descriptive_newey_west",
            outcome: bundle,
            policyDate: selectionRes.derivedWindow.policyDate,
            scopeId: "sandbox_scope",
          });
          estimates.push(est);
        } catch {
          /* skip estimate if preconditions fail */
        }
      } else if (!obsRes.ok && obsRes.error) {
        errors.push(obsRes.error);
      }
    }
  }

  const dataStatusMessage =
    charts.length > 0
      ? `Grounded in ${charts.length} live series (${charts.map((c) => c.seriesId).join(", ")}), ${estimates.length} computed estimate(s), and ${literature.length} OpenAlex literature study(s).`
      : errors[0] ??
        "No live statistical series found for this prompt. Personas will debate strictly conceptually and over cited literature without introducing numbers.";

  return {
    charts,
    bundles,
    estimates,
    literature,
    dataStatusMessage,
  };
}

export function buildFollowUps(persona: SandboxPersona): string[] {
  const others = SANDBOX_PERSONAS.filter((p) => p.id !== persona.id);
  const challenger = others[0]?.name ?? "John Maynard Keynes";
  return [
    `How would ${challenger} challenge ${persona.name}'s interpretation of this run's estimates and pre-trend diagnostics?`,
    `As ${persona.name}, which specification fork (window, transform, or control variable) would test the fragile assumptions here?`,
    `As ${persona.name}, how do the cited OpenAlex literature estimates compare with the live series estimate?`,
  ];
}

export type SandboxStreamEvent =
  | {
      type: "meta";
      persona: SandboxPersona;
      charts: ExtractedSeries[];
      estimates: EconometricEstimate[];
      literature: ExtractedLiteratureEstimate[];
      dataStatusMessage: string;
      followUps: string[];
    }
  | { type: "delta"; text: string }
  | { type: "error"; message: string }
  | { type: "done" };

const DEFAULT_MODEL = "gpt-5.6-sol";
const FALLBACK_MODELS = ["gpt-5.6-terra", "gpt-4.1"];

export async function* streamSandboxTurn(input: {
  prompt: string;
  personaId?: string;
}): AsyncGenerator<SandboxStreamEvent> {
  const persona = detectPersona(input.prompt, input.personaId);
  const evidence = await fetchSandboxLiveEvidence(input.prompt);
  const followUps = buildFollowUps(persona);

  yield {
    type: "meta",
    persona,
    charts: evidence.charts,
    estimates: evidence.estimates,
    literature: evidence.literature,
    dataStatusMessage: evidence.dataStatusMessage,
    followUps,
  };

  const allowedRegistry = buildAllowedNumericRegistry({
    bundles: evidence.bundles,
    estimates: evidence.estimates,
    literature: evidence.literature,
  });

  const estimateLines = evidence.estimates.map(
    (e) =>
      `${e.spec.outcomeSeriesId} (${e.methodLabel} · ${e.honestyLabel}): β = ${e.pointEstimate}, SE = ${e.standardError}, 95% CI [${e.ciLower}, ${e.ciUpper}], p = ${e.pValue}, N = ${e.sampleSize} (${e.sampleWindow.start} to ${e.sampleWindow.end})`,
  );

  const litLines = evidence.literature.map(
    (l) =>
      `${l.title} (${l.year ?? "n.d."})${l.pointEstimate !== undefined && l.quoteSpan ? ` — Extracted estimate: ${l.pointEstimate} (“${l.quoteSpan}”)` : ""}`,
  );

  const preferred = process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;
  const models = [preferred, ...FALLBACK_MODELS].filter(
    (m, i, a) => m.length > 0 && a.indexOf(m) === i,
  );

  const systemPrompt = `${persona.voicePrompt}
IMPORTANT LABELING & NUMERIC RULES:
1. You are a "${persona.perspectiveBanner}".
2. You MUST NOT introduce, guess, or recall any numbers of your own. You may ONLY cite exact numbers present in "computedEstimates" or "literatureWithQuotes". If no estimates are present, state explicitly that live series data is unavailable and conduct a purely qualitative institutional critique without numbers.

Structure your response into 4 sections:
## ${persona.perspectiveBanner}
## Reading This Run's Estimates & Literature
## Where Modern Orthodoxy or the Specification Is Vulnerable
## Falsification Fork & Policy Incidence`;

  let generatedText = "";
  if (hasSandboxAiCredentials()) {
    for (const modelId of models) {
      try {
        const { text } = await generateText({
          model: resolveSandboxAiModel(modelId),
          providerOptions: {
            openai: {
              reasoningEffort: "low",
              reasoningSummary: null,
            },
          },
          system: systemPrompt,
          prompt: JSON.stringify({
            userPrompt: input.prompt,
            persona: persona.name,
            era: persona.era,
            dataStatusMessage: evidence.dataStatusMessage,
            computedEstimates: estimateLines,
            literatureWithQuotes: litLines,
          }),
        });
        if (text && text.trim()) {
          generatedText = text.trim();
          break;
        }
      } catch {
        continue;
      }
    }
  }

  if (!generatedText) {
    generatedText = [
      `## ${persona.perspectiveBanner}`,
      `*(Simulated perspective — ${persona.name}, ${persona.era})*`,
      "",
      `## Reading This Run's Estimates & Literature`,
      estimateLines.length > 0
        ? estimateLines.map((l) => `- ${l}`).join("\n")
        : `- **${evidence.dataStatusMessage}** No synthetic or fallback numbers are substituted.`,
      ...(litLines.length > 0
        ? ["", "### Cited OpenAlex Literature", ...litLines.map((l) => `- ${l}`)]
        : []),
      "",
      `## Where Modern Orthodoxy or the Specification Is Vulnerable`,
      `From the standpoint of ${persona.school}, any single-equation trajectory must be tested against confounding regime shifts, price-system substitution, and long-run supply response.`,
      "",
      `## Falsification Fork & Policy Incidence`,
      `Promote this inquiry to a full Workbench Run to lock a pre-registered Scope Contract and compare alternative specification forks side-by-side.`,
    ].join("\n");
  } else {
    // Run deterministic numeric auditor on persona prose so personas cannot introduce numbers
    const audited = auditGeneratedProseNumbers(generatedText, allowedRegistry, {
      stripUntraced: true,
    });
    generatedText = audited.sanitizedText;
  }

  yield { type: "delta", text: generatedText };
  yield { type: "done" };
}
