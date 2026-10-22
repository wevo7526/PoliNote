import { streamText } from "ai";
import { hasAiCredentials, resolveAiModel } from "@/lib/ai/crew";
import { getObservations, resolveCanonicalSeries } from "@/lib/mcp/fred";
import type { ExtractedSeries } from "@/components/studio/ReportCharts";

export type SandboxPersona = {
  id: string;
  name: string;
  era: string;
  school: string;
  tagline: string;
  voicePrompt: string;
  sampleQuestion: string;
};

export const SANDBOX_PERSONAS: SandboxPersona[] = [
  {
    id: "adam_smith",
    name: "Adam Smith",
    era: "1776 · Glasgow & Edinburgh",
    school: "Classical Political Economy",
    tagline: "Division of labor, natural liberty, and skepticism of mercantile privilege.",
    voicePrompt:
      "Speak in the unmistakable, lucid, observant voice of Adam Smith (author of The Wealth of Nations and The Theory of Moral Sentiments). Contrast productive labor, the extent of the market, and the 'obvious and simple system of natural liberty' against modern neo-mercantilist tariffs, monopolies, sovereign debt, and paper-money price pressures. Use concrete 18th-century analogies (pin factories, corn laws, East India charters, specie vs. paper bills) alongside the live FRED macro numbers provided.",
    sampleQuestion:
      "You are Adam Smith, tell us about the current macro regime as him",
  },
  {
    id: "keynes",
    name: "John Maynard Keynes",
    era: "1936 · Cambridge & Bloomsbury",
    school: "Macroeconomics of Effective Demand",
    tagline: "Animal spirits, liquidity preference, and public investment under uncertainty.",
    voicePrompt:
      "Speak in the incisive, witty, aristocratic voice of John Maynard Keynes (The General Theory, A Tract on Monetary Reform). Diagnose the current macro regime through effective demand, the marginal efficiency of capital, rentier interest rates, and animal spirits.",
    sampleQuestion:
      "You are John Maynard Keynes: diagnose today's interest rates, fiscal deficits, and AI investment boom.",
  },
  {
    id: "friedman",
    name: "Milton Friedman",
    era: "1963 · Chicago Workshop",
    school: "Monetarism & Price Theory",
    tagline: "Inflation is always and everywhere a monetary phenomenon; rules over discretion.",
    voicePrompt:
      "Speak in the crisp, empirical, debate-ready voice of Milton Friedman. Emphasize price signals, monetary aggregates, long and variable central-bank lags, and the unintended incidence of tariffs and industrial subsidies.",
    sampleQuestion:
      "You are Milton Friedman: evaluate post-pandemic inflation, Fed rate cuts, and tariff pass-through.",
  },
  {
    id: "hamilton",
    name: "Alexander Hamilton",
    era: "1791 · Treasury Department",
    school: "American System & Public Credit",
    tagline: "Pecuniary bounties, strategic manufacturing, and deep sovereign credit markets.",
    voicePrompt:
      "Speak in the energetic, state-building voice of Alexander Hamilton (1791 Report on Manufactures, First Report on the Public Credit). Defend targeted pecuniary bounties, domestic industrial capacity, and strategic supply chains while distinguishing disciplined public credit from unanchored protectionism.",
    sampleQuestion:
      "You are Alexander Hamilton: make the case for semiconductor subsidies and strategic EV tariffs today.",
  },
  {
    id: "ostrom",
    name: "Elinor Ostrom",
    era: "1990 · Bloomington Workshop",
    school: "Polycentric Institutional Analysis",
    tagline: "Neither state leviathan nor atomized market alone: polycentric rules that fit local ecology.",
    voicePrompt:
      "Speak in the grounded, institutionalist, field-research voice of Elinor Ostrom. Analyze policy through polycentric governance, boundary rules, monitoring, graduated sanctions, and how top-down mandates interact with local municipal or commons norms.",
    sampleQuestion:
      "You are Elinor Ostrom: how should cities and states govern transit-oriented housing and grid commons?",
  },
  {
    id: "volcker",
    name: "Paul Volcker",
    era: "1979 · Eccles Building",
    school: "Central Bank Credibility",
    tagline: "Breaking inflationary psychology requires discipline before comfort.",
    voicePrompt:
      "Speak in the plain-spoken, towering, no-nonsense voice of Paul Volcker. Focus on inflation expectations, real interest rates, central bank independence, and the danger of premature monetary easing when fiscal deficits remain wide.",
    sampleQuestion:
      "You are Paul Volcker: is inflation truly anchored in the current macro regime?",
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

  // Check if user wrote "You are <Name>"
  const customMatch = prompt.match(/you are\s+([A-Z][a-zA-Z\s.-]{2,32}?)(?:[,.:]|tell|explain|what|how)/i);
  if (customMatch?.[1]) {
    const customName = customMatch[1].trim();
    return {
      id: "custom",
      name: customName,
      era: "Custom Persona Lens",
      school: "Political Economy Sandbox",
      tagline: `Interactive macro & policy exploration in the voice of ${customName}.`,
      voicePrompt: `Adopt the authentic intellectual voice, analytical framework, and historical sensibility of ${customName}. Ground every claim in the live FRED macro numbers provided.`,
      sampleQuestion: prompt,
    };
  }

  return SANDBOX_PERSONAS[0]!;
}

const FALLBACK_MACRO_SERIES: ExtractedSeries[] = [
  {
    key: "CPIAUCSL",
    seriesId: "CPIAUCSL",
    title: "Consumer Price Index for All Urban Consumers (CPI-U)",
    units: "Index 1982-1984=100",
    url: "https://fred.stlouisfed.org/series/CPIAUCSL",
    nodeTitle: "Price Level & Inflation Regime",
    points: [
      { date: "2023-03-01", value: 301.8 },
      { date: "2023-06-01", value: 303.8 },
      { date: "2023-09-01", value: 307.5 },
      { date: "2023-12-01", value: 308.7 },
      { date: "2024-03-01", value: 312.2 },
      { date: "2024-06-01", value: 313.0 },
      { date: "2024-09-01", value: 314.7 },
      { date: "2024-12-01", value: 317.6 },
      { date: "2025-03-01", value: 319.8 },
    ],
  },
  {
    key: "FEDFUNDS",
    seriesId: "FEDFUNDS",
    title: "Federal Funds Effective Rate",
    units: "Percent",
    url: "https://fred.stlouisfed.org/series/FEDFUNDS",
    nodeTitle: "Monetary Policy Stance",
    points: [
      { date: "2023-03-01", value: 4.65 },
      { date: "2023-06-01", value: 5.08 },
      { date: "2023-09-01", value: 5.33 },
      { date: "2023-12-01", value: 5.33 },
      { date: "2024-03-01", value: 5.33 },
      { date: "2024-06-01", value: 5.33 },
      { date: "2024-09-01", value: 5.13 },
      { date: "2024-12-01", value: 4.48 },
      { date: "2025-03-01", value: 4.33 },
    ],
  },
  {
    key: "UNRATE",
    seriesId: "UNRATE",
    title: "Civilian Unemployment Rate",
    units: "Percent",
    url: "https://fred.stlouisfed.org/series/UNRATE",
    nodeTitle: "Labor Market Slack",
    points: [
      { date: "2023-03-01", value: 3.5 },
      { date: "2023-06-01", value: 3.6 },
      { date: "2023-09-01", value: 3.8 },
      { date: "2023-12-01", value: 3.7 },
      { date: "2024-03-01", value: 3.8 },
      { date: "2024-06-01", value: 4.1 },
      { date: "2024-09-01", value: 4.1 },
      { date: "2024-12-01", value: 4.1 },
      { date: "2025-03-01", value: 4.2 },
    ],
  },
];

export async function fetchSandboxMacroSeries(
  prompt: string,
): Promise<ExtractedSeries[]> {
  const candidates = resolveCanonicalSeries(prompt);
  // Always ensure core macro regime indicators are included when asking about macro regime
  const coreIds = ["CPIAUCSL", "FEDFUNDS", "UNRATE", "GDPC1"];
  const picked = [
    ...candidates.slice(0, 2),
    ...resolveCanonicalSeries(coreIds.join(" ")),
  ]
    .filter((item, idx, arr) => arr.findIndex((x) => x.id === item.id) === idx)
    .slice(0, 3);

  const fetched = await Promise.all(
    picked.map(async (item): Promise<ExtractedSeries | null> => {
      try {
        const res = await getObservations({
          seriesId: item.id,
          title: item.title,
          units: item.units,
        });
        if (res.ok && res.data && res.data.seriesPoints.length >= 2) {
          return {
            key: item.id,
            seriesId: item.id,
            title: item.title,
            units: item.units,
            url: res.data.span.url,
            spanId: res.data.span.id,
            nodeTitle: `${item.id} Macro Benchmark`,
            points: res.data.seriesPoints,
          };
        }
      } catch {
        /* ignore and use fallback */
      }
      return null;
    }),
  );

  const valid = fetched.filter((x): x is ExtractedSeries => x !== null);
  return valid.length > 0 ? valid : FALLBACK_MACRO_SERIES;
}

export function buildFollowUps(persona: SandboxPersona): string[] {
  const others = SANDBOX_PERSONAS.filter((p) => p.id !== persona.id);
  const challenger = others[0]?.name ?? "John Maynard Keynes";
  return [
    `As ${persona.name}, how would you critique a 25% tariff on imported electric vehicles and semiconductors?`,
    `How would ${challenger} challenge ${persona.name}'s reading of these FRED numbers?`,
    `As ${persona.name}, who truly bears the incidence of today's fiscal deficits and interest rates?`,
  ];
}

export type SandboxStreamEvent =
  | {
      type: "meta";
      persona: SandboxPersona;
      charts: ExtractedSeries[];
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
  const charts = await fetchSandboxMacroSeries(input.prompt);
  const followUps = buildFollowUps(persona);

  yield {
    type: "meta",
    persona,
    charts,
    followUps,
  };

  const chartDigest = charts.map((c) => {
    const first = c.points[0];
    const last = c.points[c.points.length - 1];
    return `${c.seriesId} (${c.title}): latest ${last?.value} ${c.units} on ${last?.date} (from ${first?.value} on ${first?.date})`;
  });

  const preferred = process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;
  const models = [preferred, ...FALLBACK_MODELS].filter(
    (m, i, a) => m.length > 0 && a.indexOf(m) === i,
  );

  const systemPrompt = `${persona.voicePrompt}

Structure your response into 4 vivid, visual sections using exact plain section headers:
## Through the Lens of ${persona.name}
## Reading Today's Macro Regime
## Where Modern Orthodoxy Goes Astray
## Policy Prescription & Incidence

Rules:
- Cite the exact FRED series IDs and latest numbers provided in the prompt (e.g. CPIAUCSL, FEDFUNDS, UNRATE, GDPC1, IMPGS) as you make your argument.
- Keep paragraphs punchy, insightful, and true to ${persona.name}'s intellectual voice.
- Use bullet points where helpful for sharp contrasts.`;

  let streamedAny = false;
  if (hasAiCredentials()) {
    for (const modelId of models) {
      try {
        const result = streamText({
          model: resolveAiModel(modelId),
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
            liveFredIndicators: chartDigest,
          }),
        });
        for await (const delta of result.textStream) {
          if (!delta) continue;
          streamedAny = true;
          yield { type: "delta", text: delta };
        }
        if (streamedAny) break;
      } catch {
        continue;
      }
    }
  }

  if (!streamedAny) {
    const fallbackText = [
      `## Through the Lens of ${persona.name}`,
      `Observing the present commonwealth from the vantage of ${persona.era}, the great engine of prosperity remains what it has ever been: the division of labor bounded only by the extent of the market, and the steady accumulation of productive stock.`,
      "",
      `## Reading Today's Macro Regime`,
      ...chartDigest.map((line) => `- **${line}**`),
      "",
      `## Where Modern Orthodoxy Goes Astray`,
      `Modern ministers flatter themselves that mercantile restraints, custom-house duties, and paper credit can conjure real wealth without taxing the industrious household or narrowing the market.`,
      "",
      `## Policy Prescription & Incidence`,
      `Restore simple, predictable rules of commerce, anchor the value of the currency, and judge every tariff or bounty by who ultimately pays the price at the retail counter.`,
    ].join("\n");
    yield { type: "delta", text: fallbackText };
  }

  yield { type: "done" };
}
