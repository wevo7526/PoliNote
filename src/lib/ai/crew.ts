import { generateText, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { layoutNodes } from "@/lib/ai/layout";
import { searchPolicyWeb, type WebHit } from "@/lib/tools/firecrawl";
import type { NodeAnalysis } from "@/schemas/analysis";
import {
  DigressionEdgeKindSchema,
  DigressionNodeKindSchema,
  DigressionNodeStatusSchema,
  ConfidenceBandSchema,
  type DigressionEdge,
  type DigressionNode,
} from "@/schemas/digression";
import { AllowedMethodSchema, type ScopeContract } from "@/schemas/scope-contract";

const CrewNodeSchema = z.object({
  key: z.string().min(1).max(40),
  kind: DigressionNodeKindSchema,
  status: DigressionNodeStatusSchema,
  title: z.string().min(1),
  body: z.string().min(1),
  confidence: ConfidenceBandSchema,
  agent: z.string().min(1),
  analysisTitle: z.string().min(1),
  analysis: z.string().min(1),
});

const CrewTurnSchema = z.object({
  runTitle: z.string().min(1).max(80),
  narrations: z
    .array(
      z.object({
        agent: z.string().min(1),
        text: z.string().min(1),
      }),
    )
    .min(1)
    .max(8),
  scope: z.object({
    jurisdiction: z.string().min(1),
    horizon: z.string().min(1),
    objective: z.string().min(1),
    instrument: z.string().min(1),
    target: z.string().min(1),
    identificationStrategy: z.string().min(1),
    distributionalCut: z.string().min(1),
    baseline: z.string().min(1),
    allowedMethods: z.array(AllowedMethodSchema).min(1),
    forbiddenMoves: z.array(z.string()).min(1),
  }),
  nodes: z.array(CrewNodeSchema).min(3).max(10),
  edges: z
    .array(
      z.object({
        sourceKey: z.string().min(1),
        targetKey: z.string().min(1),
        kind: DigressionEdgeKindSchema,
        label: z.string().optional(),
      }),
    )
    .min(1),
});

export type CrewTurnResult = {
  runTitle: string;
  narrations: Array<{ agent: string; text: string }>;
  scope: ScopeContract;
  nodes: DigressionNode[];
  edges: DigressionEdge[];
  analyses: NodeAnalysis[];
};

function nowIso(): string {
  return new Date().toISOString();
}

function slugKey(key: string): string {
  return key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 32);
}

export async function runCrewTurn(input: {
  runId: string;
  question: string;
  latestMessage: string;
  prior?: {
    scope: ScopeContract | null;
    nodeTitles: string[];
  };
}): Promise<CrewTurnResult> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const web = await searchPolicyWeb(input.latestMessage || input.question);
  const ts = nowIso();

  const { output } = await generateText({
    model: openai("gpt-4o"),
    output: Output.object({ schema: CrewTurnSchema }),
    system: `You are the PoliNote digression crew (scoper, instrument parser, literature, series, legal, macro, incidence, critic).
Build a real policy argument graph for the user's question — not a canned EV-tariff demo unless they asked about EV tariffs.

Hard rules:
- Fill instrument, target, identification strategy, and horizon with your best working values.
- Never mark a node supported. Use proposed or contested. Supported requires an MCP evidence span this platform has not attached yet.
- Every node needs a substantial analysis (3–6 short paragraphs) the user can open in a modal: mechanisms, who is helped/hurt, what would change the sign, and what evidence is still missing.
- Use node keys like claim_price, mech_pass, unc_id — unique within the graph.
- Edges must reference those keys.
- Narrations are in-character, specific to THIS question, 1–3 sentences each.
- If web snippets are provided, treat them as unverified leads, not proof.`,
    prompt: JSON.stringify({
      question: input.question,
      latestUserMessage: input.latestMessage,
      priorScope: input.prior?.scope ?? null,
      existingNodeTitles: input.prior?.nodeTitles ?? [],
      webLeads: web,
    }),
  });

  if (!output) {
    throw new Error("Crew returned no structured output");
  }

  return hydrateCrewTurn(input.runId, input.question, output, web, ts);
}

function hydrateCrewTurn(
  runId: string,
  question: string,
  output: z.infer<typeof CrewTurnSchema>,
  web: WebHit[],
  ts: string,
): CrewTurnResult {
  const keyToId = new Map<string, string>();
  const nodes: DigressionNode[] = output.nodes.map((raw, index) => {
    const key = slugKey(raw.key) || `n_${index}`;
    const id = `${runId}_${key}`;
    keyToId.set(raw.key, id);
    keyToId.set(key, id);
    return {
      id,
      runId,
      kind: raw.kind,
      status: raw.status === "supported" ? "proposed" : raw.status,
      title: raw.title,
      body: raw.body,
      confidence: raw.confidence,
      agent: raw.agent,
      provenance: web.slice(0, 2).map((hit) => ({
        source: "web" as const,
        label: hit.title,
        url: hit.url,
      })),
      position: { x: 0, y: 0 },
      evidenceSpanIds: [],
      createdAt: ts,
      updatedAt: ts,
    };
  });

  const edges: DigressionEdge[] = output.edges.flatMap((edge, index) => {
    const sourceId = keyToId.get(edge.sourceKey) ?? keyToId.get(slugKey(edge.sourceKey));
    const targetId = keyToId.get(edge.targetKey) ?? keyToId.get(slugKey(edge.targetKey));
    if (!sourceId || !targetId || sourceId === targetId) return [];
    return [
      {
        id: `${runId}_e${index + 1}`,
        runId,
        sourceId,
        targetId,
        kind: edge.kind,
        label: edge.label,
        createdAt: ts,
      },
    ];
  });

  const analyses: NodeAnalysis[] = output.nodes.map((raw) => {
    const key = slugKey(raw.key);
    const nodeId = keyToId.get(raw.key) ?? keyToId.get(key) ?? `${runId}_${key}`;
    return {
      nodeId,
      runId,
      title: raw.analysisTitle,
      body: raw.analysis,
      citations: web.map((hit) => ({
        title: hit.title,
        url: hit.url,
        note: hit.snippet || undefined,
      })),
    };
  });

  const scope: ScopeContract = {
    id: `${runId}_scope`,
    question,
    jurisdiction: output.scope.jurisdiction,
    horizon: output.scope.horizon,
    objective: output.scope.objective,
    instrument: output.scope.instrument,
    target: output.scope.target,
    identificationStrategy: output.scope.identificationStrategy,
    distributionalCut: output.scope.distributionalCut,
    baseline: output.scope.baseline,
    allowedMethods: output.scope.allowedMethods,
    forbiddenMoves: output.scope.forbiddenMoves,
    mcpAllowlist: {
      "econ-series": true,
      "policy-docs": true,
      literature: true,
      workspace: true,
      trace: true,
    },
    createdAt: ts,
    updatedAt: ts,
  };

  return {
    runTitle: output.runTitle,
    narrations: output.narrations,
    scope,
    nodes: layoutNodes(nodes),
    edges,
    analyses,
  };
}
