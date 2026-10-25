import { NextResponse } from "next/server";
import { generateText } from "ai";
import { hasAiCredentials, resolveAiModel } from "@/lib/ai/crew";
import {
  collectBibliography,
  extractFredSeries,
} from "@/components/studio/ReportCharts";
import { getProject } from "@/lib/db/projects";
import { getRun, listRuns } from "@/lib/db/runs";
import {
  auditCompiledPolicyReport,
} from "@/lib/economics/auditor";
import type {
  EconometricEstimate,
  RobustnessBundle,
} from "@/lib/economics/schemas";
import { toTypedApiError } from "@/lib/env";
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

export { auditCompiledPolicyReport };

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
    (n) =>
      n.kind === "claim" || n.kind === "mechanism" || n.kind === "constraint",
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
      caption: `${supportedNodes.length} of ${activeNodes.length} active nodes are supported by econometric estimates across the policy spine stages and digression branches.`,
      interpretation:
        supportedNodes.length > 0
          ? `Econometric support is established on (${supportedNodes.map((n) => n.title).join("; ")}).`
          : "Nodes currently stand as proposed, inconclusive, or unverifiable awaiting live series estimation.",
    },
    ...fredSeries.map((s, idx) => {
      const first = s.points[0];
      const last = s.points[s.points.length - 1];
      return {
        figureLabel: `Figure ${idx + 2}`,
        title: `Live Series ${s.seriesId}: ${s.title}`,
        caption: `Official provider time series (${s.units || "Units"}), observed from ${first?.date ?? "start"} (${first?.value ?? "—"}) to ${last?.date ?? "latest"} (${last?.value ?? "—"}).`,
        interpretation: `Anchors the empirical benchmark for “${s.nodeTitle}”.`,
      };
    }),
  ];

  const incidenceRows = (
    incidenceNodes.length > 0 ? incidenceNodes : activeNodes.slice(0, 4)
  ).map((node) => ({
    group: node.title,
    direction:
      node.kind === "incidence"
        ? "Distributional Split"
        : NODE_KIND_TAXONOMY[node.kind].shortLabel,
    mechanism: node.body,
    status: NODE_STATUS_TAXONOMY[node.status].shortLabel,
  }));

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
        : `The crew mapped ${activeNodes.length} structured argument nodes backed by ${bib.length} verified reference(s) and ${fredSeries.length} live series.`,
      supportedNodes.length > 0
        ? `Supported conclusions include: ${supportedNodes.map((n) => `${n.title} (${n.body})`).join(" ")}`
        : `Core hypotheses on the map include: ${activeNodes.slice(0, 3).map((n) => `${n.title} (${n.body})`).join(" ")}`,
    ].join("\n\n"),
    keyFindings,
    spineNarrative: activeNodes
      .map(
        (node) =>
          `## ${NODE_KIND_TAXONOMY[node.kind].stage} — ${node.title} (${NODE_STATUS_TAXONOMY[node.status].shortLabel})\n${
            input.analyses[node.id]?.body.replace(/^##\s+/gm, "### ") ||
            node.body
          }`,
      )
      .join("\n\n"),
    figureNotes,
    incidenceRows,
    methodologyAndTrace: [
      `## How This Output Was Made (Provenance & Methodology)`,
      `1. **Scope Contract & Pre-Registration Locked**: ${input.scope?.instrument || "Defined policy instrument, target benchmark, identification strategy, and horizon."}`,
      `2. **Identification Strategy**: ${input.scope?.identificationStrategy || "Evaluated pathways using pre-registered econometric estimators and robustness specifications."}`,
      `3. **Empirical Spans & Data Auditor**: Pulled ${fredSeries.length} live series and ${bib.length} bibliography sources. Every number in this report passed the deterministic Data Auditor.`,
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
          "Counterfactual baselines and identification risks remain bounded by the Scope Contract.",
  };
}

function tryExtractJson(rawText: string): Record<string, unknown> | null {
  const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? rawText).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as Record<
      string,
      unknown
    >;
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
    let storedEstimates: EconometricEstimate[] = [];
    let storedRobustness: RobustnessBundle[] = [];

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
      storedEstimates = snap.estimates ?? [];
      storedRobustness = snap.robustness ?? [];
    } else if (projectId) {
      const proj = await getProject(userId, projectId);
      if (!proj) {
        return NextResponse.json(
          { error: "Project not found" },
          { status: 404 },
        );
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
        if (s.estimates) storedEstimates.push(...s.estimates);
        if (s.robustness) storedRobustness.push(...s.robustness);
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

    const fredSeries = extractFredSeries(nodes);

    if (hasAiCredentials() && nodes.length > 0) {
      const preferred =
        process.env.OPENAI_MODEL?.trim() ||
        process.env.AI_GATEWAY_MODEL?.trim() ||
        DEFAULT_MODEL;
      const models = [preferred, ...FALLBACK_MODELS].filter(
        (m, i, a) => m.length > 0 && a.indexOf(m) === i,
      );
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
            system: `You are PoliNote's Report Compiler.
Compile the provided policy graph nodes, stored econometric estimates, and bibliography into an executive report JSON object:
{
  "subtitle": "1-line jurisdiction, instrument & horizon subtitle",
  "executiveSummary": "2-3 paragraphs synthesizing the core conclusion, honesty labels, and policy tradeoffs. Cite ONLY exact numbers present in the provided estimates or fredSeries.",
  "spineNarrative": "Structured narrative with ## headings walking through 01 Policy Rule, 02 Mechanism, 03 Core Finding, 04 Empirical Proof, and 05 Distributional Impact.",
  "methodologyAndTrace": "Explanation of Scope Contract boundaries, pre-registration lock, identification strategy, and Skeptic audit.",
  "risksAndCounterfactuals": "Synthesis of counterfactual baselines, specification forks, and key identification risks."
}
Never invent or guess any numbers. Return ONLY valid JSON.`,
            prompt: JSON.stringify({
              title,
              question,
              scope: scope
                ? {
                    jurisdiction: scope.jurisdiction,
                    horizon: scope.horizon,
                    policyDate: scope.policyDate,
                    policyDateSource: scope.policyDateSource,
                    instrument: scope.instrument,
                    target: scope.target,
                    identificationStrategy: scope.identificationStrategy,
                    distributionalCut: scope.distributionalCut,
                    baseline: scope.baseline,
                  }
                : null,
              estimates: storedEstimates.map((e) => ({
                method: e.methodLabel,
                honestyLabel: e.honestyLabel,
                seriesId: e.spec.outcomeSeriesId,
                pointEstimate: e.pointEstimate,
                standardError: e.standardError,
                ciLower: e.ciLower,
                ciUpper: e.ciUpper,
                pValue: e.pValue,
                sampleSize: e.sampleSize,
              })),
              nodes: nodes.map((n) => ({
                type: NODE_KIND_TAXONOMY[n.kind].label,
                status: NODE_STATUS_TAXONOMY[n.status].label,
                honestyLabel: n.honestyLabel,
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
              baseReport.methodologyAndTrace =
                parsed.methodologyAndTrace.trim();
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

    // Run deterministic Data Auditor on the compiled report before returning.
    // Never overwrite snap.draft (the crew's audited brief).
    const auditedReport = auditCompiledPolicyReport(baseReport, {
      fredSeries,
      estimates: storedEstimates,
      robustness: storedRobustness,
    });

    return NextResponse.json({ report: auditedReport });
  } catch (error) {
    const typed = toTypedApiError(error, "compile");
    return NextResponse.json(
      { error: typed.message, errorDetail: typed },
      { status: typed.status },
    );
  }
}
