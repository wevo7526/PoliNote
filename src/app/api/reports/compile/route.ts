import { NextResponse } from "next/server";
import { generateText } from "ai";
import { hasAiCredentials, resolveAiModel } from "@/lib/ai/crew";
import { redactSecrets } from "@/lib/mcp/http";
import {
  collectBibliography,
  extractFredSeries,
} from "@/components/studio/ReportCharts";
import { getProject } from "@/lib/db/projects";
import { getRun, listRuns, persistTurn } from "@/lib/db/runs";
import type { CompiledPolicyReport } from "@/lib/reports/report-types";
import { getSessionUserId } from "@/lib/session";
import {
  NODE_KIND_TAXONOMY,
  NODE_STATUS_TAXONOMY,
} from "@/lib/ui/node-taxonomy";
import { shortNodeKey } from "@/lib/ui/prose";
import type { NodeAnalysis } from "@/schemas/analysis";
import type { DigressionNode } from "@/schemas/digression";
import type { ScopeContract } from "@/schemas/scope-contract";

export const runtime = "nodejs";
export const maxDuration = 120;

const DEFAULT_MODEL = "gpt-5.6-sol";
const FALLBACK_MODELS = ["gpt-5.6-terra", "gpt-4.1"];

function buildDeterministicReport(input: {
  title: string;
  projectTitle: string;
  question: string;
  scope: ScopeContract | null;
  nodes: DigressionNode[];
  analyses: Record<string, NodeAnalysis>;
}): CompiledPolicyReport {
  const activeNodes = input.nodes.filter((n) => n.status !== "pruned");
  const supportedNodes = activeNodes.filter((n) => n.status === "supported");
  const fredSeries = extractFredSeries(activeNodes);
  const bib = collectBibliography(activeNodes, input.analyses);

  const claimNodes = activeNodes.filter(
    (n) => n.kind === "claim" || n.kind === "mechanism" || n.kind === "constraint",
  );
  const incidenceNodes = activeNodes.filter(
    (n) => n.kind === "incidence" || n.kind === "claim",
  );
  const branchNodes = activeNodes.filter(
    (n) =>
      n.kind === "counterfactual" ||
      n.kind === "fork" ||
      n.kind === "uncertainty",
  );

  const keyFindings = (claimNodes.length > 0 ? claimNodes : activeNodes)
    .slice(0, 6)
    .map((node) => ({
      nodeType: NODE_KIND_TAXONOMY[node.kind].label,
      headline: node.title,
      detail: node.body,
      status: NODE_STATUS_TAXONOMY[node.status].label,
      citationRef: `[${shortNodeKey(node.id)}]`,
    }));

  const figureNotes = [
    {
      figureLabel: "Figure 1",
      title: "Policy Argument Map & Spine Verification Coverage",
      caption: `${supportedNodes.length} of ${activeNodes.length} active nodes are verified by empirical MCP spans across the 5 policy spine stages and digression branches.`,
      interpretation:
        supportedNodes.length > 0
          ? `Empirical verification is strongest where FRED series, OpenAlex studies, or statutory text directly corroborate the spine (${supportedNodes.map((n) => n.title).join("; ")}).`
          : "Nodes currently stand as working hypotheses or contested claims awaiting additional empirical spans.",
    },
    ...fredSeries.map((s, idx) => {
      const first = s.points[0];
      const last = s.points[s.points.length - 1];
      const delta =
        first && last && first.value !== 0
          ? (((last.value - first.value) / Math.abs(first.value)) * 100).toFixed(1)
          : "0.0";
      return {
        figureLabel: `Figure ${idx + 2}`,
        title: `FRED ${s.seriesId}: ${s.title}`,
        caption: `Official St. Louis Fed time series (${s.units || "Index"}), observed from ${first?.date ?? "start"} (${first?.value ?? "—"}) to ${last?.date ?? "latest"} (${last?.value ?? "—"}).`,
        interpretation: `Over the ${s.points.length}-period window, ${s.seriesId} moved by ${Number(delta) >= 0 ? `+${delta}%` : `${delta}%`}, anchoring the empirical benchmark for “${s.nodeTitle}”.`,
      };
    }),
  ];

  const incidenceRows = (incidenceNodes.length > 0 ? incidenceNodes : activeNodes.slice(0, 4)).map(
    (node) => ({
      group: node.title,
      direction:
        node.kind === "incidence"
          ? "Distributional Split"
          : NODE_KIND_TAXONOMY[node.kind].shortLabel,
      mechanism: node.body,
      status: NODE_STATUS_TAXONOMY[node.status].shortLabel,
    }),
  );

  return {
    title: input.title,
    subtitle: input.scope?.jurisdiction
      ? `${input.scope.jurisdiction.split(".")[0]} · ${input.scope.horizon.split(".")[0]}`
      : "Empirical Policy Digression & Provenance Report",
    projectTitle: input.projectTitle,
    preparedAt: new Date().toISOString(),
    executiveSummary: [
      `This policy report evaluates: ${input.question}`,
      input.scope?.objective
        ? input.scope.objective
        : `The crew mapped ${activeNodes.length} structured argument nodes across the 5-stage policy spine (Policy Rule, Economic Mechanism, Core Finding, Empirical Data, and Distributional Impact), backed by ${bib.length} verified reference(s) and ${fredSeries.length} FRED economic time-series chart(s).`,
      supportedNodes.length > 0
        ? `Key verified conclusions include: ${supportedNodes.map((n) => `${n.title} (${n.body})`).join(" ")}`
        : `Core hypotheses on the map include: ${activeNodes.slice(0, 3).map((n) => `${n.title} (${n.body})`).join(" ")}`,
    ].join("\n\n"),
    keyFindings,
    spineNarrative: activeNodes
      .map(
        (node) =>
          `## ${NODE_KIND_TAXONOMY[node.kind].stage} — ${node.title} (${NODE_STATUS_TAXONOMY[node.status].shortLabel})\n${
            input.analyses[node.id]?.body.replace(/^##\s+/gm, "### ") || node.body
          }`,
      )
      .join("\n\n"),
    figureNotes,
    incidenceRows,
    methodologyAndTrace: [
      `## How This Output Was Made (Provenance & Methodology)`,
      `1. **Scope Contract Locked**: ${input.scope?.instrument || "Defined policy instrument, target benchmark, identification strategy, and horizon."}`,
      `2. **Identification Strategy**: ${input.scope?.identificationStrategy || "Evaluated causal pathways using quasi-experimental and time-series benchmarks while filtering out non-causal confounders."}`,
      `3. **Empirical MCP Spans Attached**: Pulled ${fredSeries.length} FRED macroeconomic/sector series and ${bib.length} total bibliography sources. Only nodes with hashed MCP spans graduate to Verified status.`,
    ].join("\n\n"),
    risksAndCounterfactuals:
      branchNodes.length > 0
        ? branchNodes
            .map(
              (n) =>
                `- **${NODE_KIND_TAXONOMY[n.kind].label} — ${n.title}**: ${n.body}`,
            )
            .join("\n")
        : input.scope?.baseline ||
          "No-policy baseline continuation and identification risks remain bounded by the Scope Contract.",
  };
}

function tryExtractJson(rawText: string): Record<string, unknown> | null {
  const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? rawText).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const userId = await getSessionUserId();
    const body = (await request.json().catch(() => null)) as {
      runId?: unknown;
      projectId?: unknown;
    } | null;

    const runId = typeof body?.runId === "string" ? body.runId.trim() : "";
    const projectId =
      typeof body?.projectId === "string" ? body.projectId.trim() : "";

    let title = "Policy Research Report";
    let projectTitle = "Policy Research Studio";
    let question = "";
    let scope: ScopeContract | null = null;
    let nodes: DigressionNode[] = [];
    let analyses: Record<string, NodeAnalysis> = {};

    if (runId) {
      const snap = await getRun(userId, runId);
      if (!snap) {
        return NextResponse.json({ error: "Run not found" }, { status: 404 });
      }
      if (snap.run.projectId) {
        const proj = await getProject(userId, snap.run.projectId);
        if (proj) projectTitle = proj.title;
      }
      title = snap.run.title;
      question =
        snap.scope?.question ||
        snap.items.find((i) => i.kind === "user")?.text ||
        snap.run.title;
      scope = snap.scope;
      nodes = snap.nodes;
      analyses = snap.analyses;
    } else if (projectId) {
      const proj = await getProject(userId, projectId);
      if (!proj) {
        return NextResponse.json({ error: "Project not found" }, { status: 404 });
      }
      projectTitle = proj.title;
      title = `${proj.title} — Master Policy Report`;
      question = proj.description;
      const allRuns = await listRuns(userId);
      const projRuns = allRuns.filter((r) => r.projectId === projectId);
      const snaps = await Promise.all(
        projRuns.slice(0, 10).map((r) => getRun(userId, r.id)),
      );
      for (const s of snaps) {
        if (!s) continue;
        if (!scope && s.scope) scope = s.scope;
        nodes.push(...s.nodes);
        Object.assign(analyses, s.analyses);
      }
    } else {
      return NextResponse.json(
        { error: "runId or projectId is required" },
        { status: 400 },
      );
    }

    const baseReport = buildDeterministicReport({
      title,
      projectTitle,
      question,
      scope,
      nodes,
      analyses,
    });

    if (hasAiCredentials() && nodes.length > 0) {
      const preferred =
        process.env.OPENAI_MODEL?.trim() ||
        process.env.AI_GATEWAY_MODEL?.trim() ||
        DEFAULT_MODEL;
      const models = [preferred, ...FALLBACK_MODELS].filter(
        (m, i, a) => m.length > 0 && a.indexOf(m) === i,
      );
      const fredSeries = extractFredSeries(nodes);
      const bib = collectBibliography(nodes, analyses);

      for (const modelId of models) {
        try {
          const { text } = await generateText({
            model: resolveAiModel(modelId),
            providerOptions: {
              openai: {
                reasoningEffort: "low",
                reasoningSummary: null,
              },
            },
            system: `You are PoliNote's Chief Economist & Report Compiler.
Compile the provided policy graph nodes, empirical FRED time-series charts, and bibliography into a clear, authoritative executive report JSON object:
{
  "subtitle": "1-line jurisdiction, instrument & horizon subtitle",
  "executiveSummary": "2-3 lucid paragraphs synthesizing the core conclusion, empirical FRED numbers, and policy tradeoffs. No raw UUIDs.",
  "spineNarrative": "Structured narrative with ## headings walking through 01 Policy Rule, 02 Economic Mechanism, 03 Core Finding, 04 Empirical Data, and 05 Distributional Impact.",
  "methodologyAndTrace": "Clear explanation of how this output was made: Scope Contract boundaries, identification strategy, MCP data sources queried, and Critic audit.",
  "risksAndCounterfactuals": "Synthesis of counterfactual baselines, policy design forks, and key identification risks."
}
Return ONLY valid JSON.`,
            prompt: JSON.stringify({
              title,
              question,
              scope: scope
                ? {
                    jurisdiction: scope.jurisdiction,
                    horizon: scope.horizon,
                    instrument: scope.instrument,
                    target: scope.target,
                    identificationStrategy: scope.identificationStrategy,
                    distributionalCut: scope.distributionalCut,
                    baseline: scope.baseline,
                  }
                : null,
              nodes: nodes.map((n) => ({
                type: NODE_KIND_TAXONOMY[n.kind].label,
                status: NODE_STATUS_TAXONOMY[n.status].label,
                title: n.title,
                body: n.body,
              })),
              fredSeries: fredSeries.map((s) => ({
                seriesId: s.seriesId,
                title: s.title,
                units: s.units,
                first: s.points[0],
                last: s.points[s.points.length - 1],
              })),
              sourcesCount: bib.length,
            }),
          });

          const parsed = tryExtractJson(text);
          if (parsed) {
            if (typeof parsed.subtitle === "string" && parsed.subtitle.trim()) {
              baseReport.subtitle = parsed.subtitle.trim();
            }
            if (
              typeof parsed.executiveSummary === "string" &&
              parsed.executiveSummary.trim()
            ) {
              baseReport.executiveSummary = parsed.executiveSummary.trim();
            }
            if (
              typeof parsed.spineNarrative === "string" &&
              parsed.spineNarrative.trim()
            ) {
              baseReport.spineNarrative = parsed.spineNarrative.trim();
            }
            if (
              typeof parsed.methodologyAndTrace === "string" &&
              parsed.methodologyAndTrace.trim()
            ) {
              baseReport.methodologyAndTrace = parsed.methodologyAndTrace.trim();
            }
            if (
              typeof parsed.risksAndCounterfactuals === "string" &&
              parsed.risksAndCounterfactuals.trim()
            ) {
              baseReport.risksAndCounterfactuals =
                parsed.risksAndCounterfactuals.trim();
            }
            break;
          }
        } catch {
          continue;
        }
      }
    }

    // If compiled for a specific run, also persist the updated brief & appendix
    if (runId) {
      const snap = await getRun(userId, runId);
      if (snap) {
        await persistTurn(userId, runId, {
          title: snap.run.title,
          status: snap.run.status,
          items: snap.items,
          nodes: snap.nodes,
          edges: snap.edges,
          scope: snap.scope,
          analyses: Object.values(snap.analyses),
          draft: {
            brief: `## Executive Summary\n\n${baseReport.executiveSummary}\n\n${baseReport.spineNarrative}`,
            appendix: `${baseReport.methodologyAndTrace}\n\n## Counterfactuals & Key Risks\n\n${baseReport.risksAndCounterfactuals}`,
            updatedAt: baseReport.preparedAt,
          },
          events: snap.events,
        });
      }
    }

    return NextResponse.json({ report: baseReport });
  } catch (error) {
    const raw =
      error instanceof Error ? error.message : "Could not compile report.";
    return NextResponse.json({ error: redactSecrets(raw) }, { status: 500 });
  }
}
