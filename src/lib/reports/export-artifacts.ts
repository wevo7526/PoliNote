"use client";

import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type {
  BibliographyEntry,
  ExtractedSeries,
} from "@/components/studio/ReportCharts";
import {
  LANE_LABEL,
  LANE_X,
  NODE_H,
  NODE_W,
  SPINE_LANES,
  layoutPolicyGraph,
  nodeLane,
  type PolicyLane,
} from "@/lib/ai/layout";
import {
  buildRunEconomicModel,
  type CounterfactualSeries,
  type ImpulseResponseSeries,
} from "@/lib/economics/engine";
import type {
  CompiledPolicyReport,
  FullReportBundle,
} from "@/lib/reports/report-types";
import {
  NODE_KIND_TAXONOMY,
  NODE_STATUS_TAXONOMY,
} from "@/lib/ui/node-taxonomy";
import { shortNodeKey } from "@/lib/ui/prose";
import type { NodeAnalysis } from "@/schemas/analysis";
import type { DigressionEdge, DigressionNode } from "@/schemas/digression";
import type { ScopeContract } from "@/schemas/scope-contract";

type RenderedPng = {
  dataUrl: string;
  bytes: Uint8Array;
  width: number;
  height: number;
};

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1] ?? "";
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function slugFilename(title: string, ext: "docx" | "pdf"): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `${slug || "polinote-report"}.${ext}`;
}

function stripMarkdown(raw: string): string {
  return raw
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

export function buildClientFallbackReport(input: {
  title: string;
  projectTitle: string;
  question: string;
  scope: ScopeContract | null;
  nodes: DigressionNode[];
  analyses: Record<string, NodeAnalysis>;
  fredSeries: ExtractedSeries[];
  bibliography: BibliographyEntry[];
  briefText?: string;
  appendixText?: string;
}): CompiledPolicyReport {
  const activeNodes = input.nodes.filter((n) => n.status !== "pruned");
  const supported = activeNodes.filter((n) => n.status === "supported");

  const keyFindings = activeNodes.slice(0, 6).map((node) => ({
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
      caption: `${supported.length} of ${activeNodes.length} argument nodes verified by empirical MCP spans across the 5 policy spine stages and digression branches.`,
      interpretation:
        supported.length > 0
          ? `Verified nodes (${supported.map((n) => n.title).join(", ")}) anchor the primary causal chain with hashed empirical evidence.`
          : "Argument nodes are mapped across the 5 spine stages; attach additional MCP spans to graduate hypotheses to Verified.",
    },
    ...input.fredSeries.map((s, idx) => {
      const first = s.points[0];
      const last = s.points[s.points.length - 1];
      return {
        figureLabel: `Figure ${idx + 2}`,
        title: `FRED ${s.seriesId}: ${s.title}`,
        caption: `Official St. Louis Fed series (${s.units || "Index"}), ${first?.date ?? ""} (${first?.value ?? ""}) to ${last?.date ?? ""} (${last?.value ?? ""}).`,
        interpretation: `Provides the empirical time-series benchmark for “${s.nodeTitle}”.`,
      };
    }),
  ];

  const incidenceNodes = activeNodes.filter(
    (n) => n.kind === "incidence" || n.kind === "claim" || n.kind === "mechanism",
  );

  return {
    title: input.title,
    subtitle: input.scope?.jurisdiction
      ? `${input.scope.jurisdiction.split(".")[0]} · ${input.scope.horizon.split(".")[0]}`
      : "Empirical Policy Digression & Provenance Report",
    projectTitle: input.projectTitle,
    preparedAt: new Date().toISOString(),
    executiveSummary:
      input.briefText && input.briefText.trim()
        ? stripMarkdown(input.briefText)
        : `This report evaluates ${input.question}. Across ${activeNodes.length} mapped nodes, ${supported.length} finding(s) are verified by empirical MCP spans and ${input.fredSeries.length} FRED time-series chart(s).`,
    keyFindings,
    spineNarrative: activeNodes
      .map(
        (n) =>
          `${NODE_KIND_TAXONOMY[n.kind].stage} — ${n.title} (${NODE_STATUS_TAXONOMY[n.status].shortLabel})\n${
            stripMarkdown(input.analyses[n.id]?.body ?? n.body)
          }`,
      )
      .join("\n\n"),
    figureNotes,
    incidenceRows: (incidenceNodes.length > 0 ? incidenceNodes : activeNodes).map(
      (n) => ({
        group: n.title,
        direction: NODE_KIND_TAXONOMY[n.kind].shortLabel,
        mechanism: n.body,
        status: NODE_STATUS_TAXONOMY[n.status].shortLabel,
      }),
    ),
    methodologyAndTrace:
      input.appendixText && input.appendixText.trim()
        ? stripMarkdown(input.appendixText)
        : [
            `Scope Instrument: ${input.scope?.instrument || "Specified in run contract."}`,
            `Target Benchmark: ${input.scope?.target || "Specified in run contract."}`,
            `Identification Strategy: ${input.scope?.identificationStrategy || "Quasi-experimental and time-series evaluation."}`,
            `Baseline Continuation: ${input.scope?.baseline || "Status-quo policy continuation."}`,
          ].join("\n\n"),
    risksAndCounterfactuals: activeNodes
      .filter(
        (n) =>
          n.kind === "counterfactual" ||
          n.kind === "fork" ||
          n.kind === "uncertainty",
      )
      .map((n) => `${NODE_KIND_TAXONOMY[n.kind].label} — ${n.title}: ${n.body}`)
      .join("\n\n"),
  };
}

/**
 * Renders Figure 1: Policy Spine & Verification Coverage Bar Chart to a high-res PNG canvas.
 */
function renderSpineCoveragePng(nodes: DigressionNode[]): RenderedPng {
  const width = 1200;
  const height = 460;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#111319";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(212,180,131,0.35)";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, width - 2, height - 2);

  // Header
  ctx.fillStyle = "#d4b483";
  ctx.font = "bold 14px Segoe UI, sans-serif";
  ctx.fillText("FIGURE 1 · POLICY SPINE & EMPIRICAL VERIFICATION COVERAGE", 36, 40);

  const totalSupported = nodes.filter((n) => n.status === "supported").length;
  ctx.fillStyle = "#f3eee4";
  ctx.font = "bold 22px Georgia, serif";
  ctx.fillText(
    `Verification Standing Across Policy Stages (${totalSupported}/${nodes.length} Verified)`,
    36,
    72,
  );

  // Legend
  const legendItems = [
    { label: "Verified by Empirical Data", color: "#8fbf9a", x: 700 },
    { label: "Contested / Needs Proof", color: "#d4a08c", x: 900 },
    { label: "Working Hypothesis", color: "#d4b483", x: 1065 },
  ];
  for (const item of legendItems) {
    ctx.fillStyle = item.color;
    ctx.fillRect(item.x, 56, 12, 12);
    ctx.fillStyle = "#c8c2b6";
    ctx.font = "12px Segoe UI, sans-serif";
    ctx.fillText(item.label, item.x + 18, 66);
  }

  const lanes: PolicyLane[] = [...SPINE_LANES, "digression"];
  let y = 112;
  for (const lane of lanes) {
    const laneNodes = nodes.filter((n) => nodeLane(n.kind) === lane);
    const sup = laneNodes.filter((n) => n.status === "supported").length;
    const cont = laneNodes.filter((n) => n.status === "contested").length;
    const prop = laneNodes.filter(
      (n) => n.status !== "supported" && n.status !== "contested",
    ).length;
    const total = Math.max(1, laneNodes.length);

    const label =
      lane === "digression"
        ? "06 · Digression Branches (What-Ifs & Risks)"
        : LANE_LABEL[lane];
    ctx.fillStyle = "#f3eee4";
    ctx.font = "bold 14px Segoe UI, sans-serif";
    ctx.fillText(label, 36, y);

    ctx.fillStyle = "#9a9284";
    ctx.font = "13px Consolas, monospace";
    ctx.fillText(
      `${sup} verified · ${cont} needs proof · ${prop} hypothesis (${laneNodes.length} total)`,
      780,
      y,
    );

    const barX = 36;
    const barY = y + 10;
    const barW = width - 72;
    const barH = 22;
    ctx.fillStyle = "#1b1e26";
    ctx.fillRect(barX, barY, barW, barH);

    let cursorX = barX;
    if (sup > 0) {
      const w = (sup / total) * barW;
      ctx.fillStyle = "#8fbf9a";
      ctx.fillRect(cursorX, barY, w, barH);
      cursorX += w;
    }
    if (cont > 0) {
      const w = (cont / total) * barW;
      ctx.fillStyle = "#d4a08c";
      ctx.fillRect(cursorX, barY, w, barH);
      cursorX += w;
    }
    if (prop > 0) {
      const w = (prop / total) * barW;
      ctx.fillStyle = "rgba(212,180,131,0.55)";
      ctx.fillRect(cursorX, barY, w, barH);
    }

    y += 56;
  }

  const dataUrl = canvas.toDataURL("image/png");
  return { dataUrl, bytes: dataUrlToBytes(dataUrl), width, height };
}

/**
 * Renders a FRED Empirical Time-Series Chart to a high-res PNG canvas.
 */
function renderFredSeriesPng(
  series: ExtractedSeries,
  figureIndex: number,
): RenderedPng {
  const width = 1200;
  const height = 460;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#111319";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(143,191,154,0.4)";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, width - 2, height - 2);

  const pts = series.points;
  const values = pts.map((p) => p.value);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV || 1;
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  const delta = last.value - first.value;
  const pct =
    first.value !== 0 ? ((delta / Math.abs(first.value)) * 100).toFixed(1) : "0.0";

  // Header
  ctx.fillStyle = "#d4b483";
  ctx.font = "bold 14px Segoe UI, sans-serif";
  ctx.fillText(
    `FIGURE ${figureIndex} · FRED EMPIRICAL SERIES (${series.seriesId})`,
    36,
    40,
  );

  ctx.fillStyle = "#f3eee4";
  ctx.font = "bold 22px Georgia, serif";
  ctx.fillText(series.title.slice(0, 72), 36, 72);

  ctx.fillStyle = "#9a9284";
  ctx.font = "13px Segoe UI, sans-serif";
  ctx.fillText(
    `Units: ${series.units || "Index"} · Supports Node: ${series.nodeTitle}`,
    36,
    96,
  );

  // Latest callout on right
  ctx.fillStyle = "#8fbf9a";
  ctx.font = "bold 26px Consolas, monospace";
  const latestText = `Latest: ${last.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  ctx.fillText(latestText, width - 340, 68);
  ctx.fillStyle = "#c8c2b6";
  ctx.font = "13px Consolas, monospace";
  ctx.fillText(
    `${delta >= 0 ? `+${pct}%` : `${pct}%`} (${first.date} → ${last.date})`,
    width - 340,
    92,
  );

  // Plot area
  const padL = 88;
  const padR = 48;
  const padT = 128;
  const padB = 64;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  // Gridlines + Y axis labels
  ctx.strokeStyle = "rgba(243,238,228,0.12)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const gy = padT + (i / 4) * plotH;
    ctx.beginPath();
    ctx.moveTo(padL, gy);
    ctx.lineTo(width - padR, gy);
    ctx.stroke();

    const val = maxV - (i / 4) * range;
    ctx.fillStyle = "#9a9284";
    ctx.font = "12px Consolas, monospace";
    ctx.fillText(val.toFixed(1), 24, gy + 4);
  }

  const coords = pts.map((pt, idx) => ({
    x: padL + (idx / Math.max(1, pts.length - 1)) * plotW,
    y: padT + plotH - ((pt.value - minV) / range) * plotH,
    date: pt.date,
    value: pt.value,
  }));

  // Shaded area under curve
  ctx.beginPath();
  coords.forEach((c, idx) => {
    if (idx === 0) ctx.moveTo(c.x, c.y);
    else ctx.lineTo(c.x, c.y);
  });
  ctx.lineTo(coords[coords.length - 1]!.x, padT + plotH);
  ctx.lineTo(coords[0]!.x, padT + plotH);
  ctx.closePath();
  ctx.fillStyle = "rgba(143,191,154,0.18)";
  ctx.fill();

  // Line
  ctx.beginPath();
  coords.forEach((c, idx) => {
    if (idx === 0) ctx.moveTo(c.x, c.y);
    else ctx.lineTo(c.x, c.y);
  });
  ctx.strokeStyle = "#8fbf9a";
  ctx.lineWidth = 3.2;
  ctx.stroke();

  // Points
  for (const c of coords) {
    ctx.beginPath();
    ctx.arc(c.x, c.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#d4b483";
    ctx.fill();
  }

  // X-axis dates
  ctx.fillStyle = "#c8c2b6";
  ctx.font = "12px Consolas, monospace";
  ctx.fillText(`${first.date} (min ${minV.toFixed(2)})`, padL, height - 22);
  const mid = coords[Math.floor(coords.length / 2)];
  if (mid) {
    ctx.fillText(mid.date, mid.x - 36, height - 22);
  }
  ctx.fillText(
    `${last.date} (max ${maxV.toFixed(2)}) · Source: St. Louis Fed (FRED)`,
    width - padR - 420,
    height - 22,
  );

  const dataUrl = canvas.toDataURL("image/png");
  return { dataUrl, bytes: dataUrlToBytes(dataUrl), width, height };
}

/**
 * Renders the Policy Argument Knowledge Graph Blueprint to a high-res PNG canvas.
 */
function renderArgumentMapPng(
  nodes: DigressionNode[],
  edges: DigressionEdge[],
): RenderedPng {
  const layout = layoutPolicyGraph(
    nodes.filter((n) => n.status !== "pruned"),
    edges,
  );
  const width = Math.max(1540, LANE_X.incidence + NODE_W + 60);
  const height = Math.max(520, layout.bandBottom + 48);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#0e1015";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(212,180,131,0.35)";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, width - 2, height - 2);

  // Swimlanes
  for (const lane of SPINE_LANES) {
    const x = LANE_X[lane];
    ctx.fillStyle = "rgba(243,238,228,0.025)";
    ctx.fillRect(x - 10, 12, NODE_W + 20, layout.spineBottom - 12);
    ctx.strokeStyle = "rgba(243,238,228,0.1)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 10, 12, NODE_W + 20, layout.spineBottom - 12);

    ctx.fillStyle = "#d4b483";
    ctx.font = "bold 12px Segoe UI, sans-serif";
    ctx.fillText(LANE_LABEL[lane].toUpperCase(), x, 34);
  }

  // Digression band
  ctx.fillStyle = "rgba(212,180,131,0.03)";
  ctx.fillRect(
    LANE_X.instrument - 10,
    layout.bandTop,
    LANE_X.incidence + NODE_W - LANE_X.instrument + 20,
    Math.max(110, layout.bandBottom - layout.bandTop),
  );
  ctx.fillStyle = "#d4b483";
  ctx.font = "bold 12px Segoe UI, sans-serif";
  ctx.fillText(
    "DIGRESSION BRANCHES (WHAT-IF BASELINES, FORKS & KEY RISKS)",
    LANE_X.instrument,
    layout.bandTop + 22,
  );

  const byId = new Map(layout.nodes.map((n) => [n.id, n]));

  // Edges
  for (const edge of edges) {
    const from = byId.get(edge.sourceId);
    const to = byId.get(edge.targetId);
    if (!from || !to) continue;
    const x1 = from.position.x + NODE_W / 2;
    const y1 = from.position.y + NODE_H / 2;
    const x2 = to.position.x + NODE_W / 2;
    const y2 = to.position.y + NODE_H / 2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.bezierCurveTo((x1 + x2) / 2, y1, (x1 + x2) / 2, y2, x2, y2);
    ctx.strokeStyle =
      edge.kind === "attacks" ? "#d46a6a" : "rgba(212,180,131,0.65)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Nodes
  for (const node of layout.nodes) {
    const kindInfo = NODE_KIND_TAXONOMY[node.kind];
    const statusInfo = NODE_STATUS_TAXONOMY[node.status];
    ctx.fillStyle = "#141720";
    ctx.fillRect(node.position.x, node.position.y, NODE_W, NODE_H);
    ctx.strokeStyle = statusInfo.color;
    ctx.lineWidth = 2;
    ctx.strokeRect(node.position.x, node.position.y, NODE_W, NODE_H);

    ctx.fillStyle = kindInfo.color;
    ctx.fillRect(node.position.x, node.position.y, 5, NODE_H);

    ctx.font = "bold 11px Segoe UI, sans-serif";
    ctx.fillStyle = kindInfo.color;
    ctx.fillText(kindInfo.shortLabel.toUpperCase(), node.position.x + 14, node.position.y + 20);

    ctx.font = "bold 10px Segoe UI, sans-serif";
    ctx.fillStyle = statusInfo.color;
    ctx.fillText(
      statusInfo.shortLabel.toUpperCase(),
      node.position.x + NODE_W - 78,
      node.position.y + 20,
    );

    ctx.font = "bold 13px Segoe UI, sans-serif";
    ctx.fillStyle = "#f3eee4";
    ctx.fillText(node.title.slice(0, 30), node.position.x + 14, node.position.y + 44);
    if (node.title.length > 30) {
      ctx.fillText(
        `${node.title.slice(30, 58)}${node.title.length > 58 ? "…" : ""}`,
        node.position.x + 14,
        node.position.y + 61,
      );
    }

    ctx.font = "10px Segoe UI, sans-serif";
    ctx.fillStyle = "#9a9284";
    ctx.fillText(
      node.evidenceSpanIds.length > 0
        ? `✓ ${node.evidenceSpanIds.length} empirical source(s)`
        : kindInfo.stage,
      node.position.x + 14,
      node.position.y + 79,
    );
  }

  const dataUrl = canvas.toDataURL("image/png");
  return { dataUrl, bytes: dataUrlToBytes(dataUrl), width, height };
}

function makeTableCell(
  text: string,
  options?: { bold?: boolean; shading?: string; color?: string },
): TableCell {
  return new TableCell({
    shading: options?.shading
      ? { fill: options.shading, type: ShadingType.CLEAR, color: "auto" }
      : undefined,
    children: [
      new Paragraph({
        spacing: { before: 80, after: 80 },
        children: [
          new TextRun({
            text,
            bold: options?.bold,
            size: 20,
            color: options?.color ?? "1E2028",
            font: "Calibri",
          }),
        ],
      }),
    ],
  });
}

/**
 * Renders the Counterfactual Time-Series Projection Fan Chart (Historical 2021-2025 + Baseline vs. Policy 2026-2030) to a high-res PNG canvas.
 */
function renderCounterfactualPng(series: CounterfactualSeries): RenderedPng {
  const width = 1200;
  const height = 460;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#111319";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(143,191,154,0.45)";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, width - 2, height - 2);

  const pts = series.points;
  const allVals = pts.flatMap((p) => [p.baseline, p.policy, p.lowerBand, p.upperBand]);
  const minV = Math.min(...allVals) - 1.5;
  const maxV = Math.max(...allVals) + 1.5;
  const range = maxV - minV || 1;

  ctx.fillStyle = "#d4b483";
  ctx.font = "bold 14px Segoe UI, sans-serif";
  ctx.fillText("COUNTERFACTUAL TIME-SERIES PROJECTION (2021–2030, 90% CI FAN)", 36, 40);

  ctx.fillStyle = "#f3eee4";
  ctx.font = "bold 22px Georgia, serif";
  ctx.fillText(series.title.slice(0, 72), 36, 72);

  ctx.fillStyle = "#9a9284";
  ctx.font = "13px Segoe UI, sans-serif";
  ctx.fillText(`${series.subtitle} · ${series.units}`, 36, 96);

  const net = series.netPolicyEffectPct;
  ctx.fillStyle = net >= 0 ? "#8fbf9a" : "#d4a08c";
  ctx.font = "bold 24px Consolas, monospace";
  ctx.fillText(
    `Net Policy Effect: ${net >= 0 ? `+${net}%` : `${net}%`} vs. Baseline`,
    width - 420,
    72,
  );

  const padL = 84;
  const padR = 48;
  const padT = 124;
  const padB = 60;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const xOf = (idx: number) => padL + (idx / Math.max(1, pts.length - 1)) * plotW;
  const yOf = (val: number) => padT + plotH - ((val - minV) / range) * plotH;

  // Gridlines
  ctx.strokeStyle = "rgba(243,238,228,0.12)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const gy = padT + (i / 4) * plotH;
    ctx.beginPath();
    ctx.moveTo(padL, gy);
    ctx.lineTo(width - padR, gy);
    ctx.stroke();

    const val = maxV - (i / 4) * range;
    ctx.fillStyle = "#9a9284";
    ctx.font = "12px Consolas, monospace";
    ctx.fillText(val.toFixed(1), 24, gy + 4);
  }

  // Intervention line
  const intIdx = Math.max(0, pts.findIndex((p) => p.isForecast));
  const intX = xOf(intIdx);
  ctx.strokeStyle = "rgba(212,180,131,0.5)";
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(intX, padT);
  ctx.lineTo(intX, padT + plotH);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#d4b483";
  ctx.font = "bold 12px Segoe UI, sans-serif";
  ctx.fillText(`Policy Enacted (${series.interventionPeriod}) →`, intX + 8, padT + 16);

  // 90% CI Fan
  const forecastStart = Math.max(0, intIdx - 1);
  ctx.beginPath();
  for (let i = forecastStart; i < pts.length; i += 1) {
    const x = xOf(i);
    const y = yOf(pts[i]!.upperBand);
    if (i === forecastStart) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  for (let i = pts.length - 1; i >= forecastStart; i -= 1) {
    ctx.lineTo(xOf(i), yOf(pts[i]!.lowerBand));
  }
  ctx.closePath();
  ctx.fillStyle = "rgba(143,191,154,0.18)";
  ctx.fill();

  // Baseline dashed curve
  ctx.strokeStyle = "#9a9284";
  ctx.lineWidth = 2.2;
  ctx.setLineDash([7, 5]);
  ctx.beginPath();
  pts.forEach((p, idx) => {
    const x = xOf(idx);
    const y = yOf(p.baseline);
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.setLineDash([]);

  // Policy solid curve
  ctx.strokeStyle = "#8fbf9a";
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  pts.forEach((p, idx) => {
    const x = xOf(idx);
    const y = yOf(p.policy);
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  pts.forEach((p, idx) => {
    ctx.fillStyle = "#c8c2b6";
    ctx.font = "12px Consolas, monospace";
    ctx.fillText(p.period, xOf(idx) - 14, height - 20);
  });

  const dataUrl = canvas.toDataURL("image/png");
  return { dataUrl, bytes: dataUrlToBytes(dataUrl), width, height };
}

/**
 * Renders the Dynamic Impulse-Response Curves Chart (Q+1 to Q+8) to a high-res PNG canvas.
 */
function renderImpulseResponsePng(series: ImpulseResponseSeries): RenderedPng {
  const width = 1200;
  const height = 460;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#111319";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(212,180,131,0.4)";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, width - 2, height - 2);

  const pts = series.points;
  const allVals = [
    0,
    ...pts.flatMap((p) => [p.priceChannel, p.outputChannel, p.employmentFiscalChannel]),
  ];
  const minV = Math.min(...allVals) - 1.2;
  const maxV = Math.max(...allVals) + 1.2;
  const range = maxV - minV || 1;

  ctx.fillStyle = "#d4b483";
  ctx.font = "bold 14px Segoe UI, sans-serif";
  ctx.fillText("DYNAMIC IMPULSE-RESPONSE FUNCTIONS (Q+1 TO Q+8)", 36, 40);

  ctx.fillStyle = "#f3eee4";
  ctx.font = "bold 22px Georgia, serif";
  ctx.fillText(series.title, 36, 72);

  ctx.fillStyle = "#9a9284";
  ctx.font = "13px Segoe UI, sans-serif";
  ctx.fillText(
    `${series.channelLabels.price} (Copper) · ${series.channelLabels.output} (Green) · ${series.channelLabels.employmentFiscal} (Blue)`,
    36,
    96,
  );

  const padL = 84;
  const padR = 48;
  const padT = 124;
  const padB = 60;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const xOf = (idx: number) => padL + (idx / Math.max(1, pts.length - 1)) * plotW;
  const yOf = (val: number) => padT + plotH - ((val - minV) / range) * plotH;

  const zeroY = yOf(0);
  ctx.strokeStyle = "rgba(243,238,228,0.28)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(padL, zeroY);
  ctx.lineTo(width - padR, zeroY);
  ctx.stroke();

  const drawCurve = (pick: (p: (typeof pts)[number]) => number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    pts.forEach((p, idx) => {
      const x = xOf(idx);
      const y = yOf(pick(p));
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  };

  drawCurve((p) => p.priceChannel, "#d4b483");
  drawCurve((p) => p.outputChannel, "#8fbf9a");
  drawCurve((p) => p.employmentFiscalChannel, "#9bb4d4");

  pts.forEach((p, idx) => {
    ctx.fillStyle = "#c8c2b6";
    ctx.font = "12px Consolas, monospace";
    ctx.fillText(p.horizon, xOf(idx) - 12, height - 20);
  });

  const dataUrl = canvas.toDataURL("image/png");
  return { dataUrl, bytes: dataUrlToBytes(dataUrl), width, height };
}

/**
 * Generates and downloads a native Microsoft Word (.docx) Policy Report with embedded charts & tables.
 */
export async function downloadWordReport(bundle: FullReportBundle): Promise<void> {
  const { report, nodes, edges, analyses = {}, scope, fredSeries, bibliography } = bundle;
  const activeNodes = nodes.filter((n) => n.status !== "pruned");
  const econModel = buildRunEconomicModel({
    question: scope?.question ?? report.title,
    scope,
    nodes: activeNodes,
    fredSeries,
  });
  const counterfactualPng = econModel.counterfactual
    ? renderCounterfactualPng(econModel.counterfactual)
    : null;
  const impulsePng = econModel.impulseResponse
    ? renderImpulseResponsePng(econModel.impulseResponse)
    : null;
  const spinePng = renderSpineCoveragePng(activeNodes);
  const mapPng = renderArgumentMapPng(activeNodes, edges);
  const fredPngs = fredSeries.map((s, idx) => ({
    series: s,
    png: renderFredSeriesPng(s, idx + 4),
    note: report.figureNotes[idx + 1],
  }));

  const children: Array<Paragraph | Table> = [];

  // Title Header
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `POLINOTE POLICY RESEARCH REPORT · ${report.projectTitle.toUpperCase()}`,
          bold: true,
          size: 18,
          color: "9A6B32",
          font: "Calibri",
        }),
      ],
      spacing: { after: 120 },
    }),
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [
        new TextRun({
          text: report.title,
          bold: true,
          size: 44,
          color: "111319",
          font: "Georgia",
        }),
      ],
      spacing: { after: 120 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `${report.subtitle} · Prepared ${new Date(report.preparedAt).toLocaleDateString()}`,
          italics: true,
          size: 22,
          color: "555866",
          font: "Calibri",
        }),
      ],
      spacing: { after: 320 },
    }),
  );

  // 1. Executive Summary
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [
        new TextRun({
          text: "1. Executive Summary",
          bold: true,
          size: 30,
          color: "111319",
          font: "Georgia",
        }),
      ],
      spacing: { before: 240, after: 140 },
    }),
  );

  for (const para of stripMarkdown(report.executiveSummary).split(/\n\n+/)) {
    if (!para.trim()) continue;
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: para.trim(),
            size: 22,
            color: "1E2028",
            font: "Calibri",
          }),
        ],
        spacing: { after: 160 },
      }),
    );
  }

  // 2. Key Findings Table
  if (report.keyFindings.length > 0) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [
          new TextRun({
            text: "2. Key Policy Findings & Verification Standing",
            bold: true,
            size: 30,
            color: "111319",
            font: "Georgia",
          }),
        ],
        spacing: { before: 280, after: 140 },
      }),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              makeTableCell("Node Type & Role", { bold: true, shading: "EAE6DF" }),
              makeTableCell("Finding / Headline", { bold: true, shading: "EAE6DF" }),
              makeTableCell("Summary & Mechanism", { bold: true, shading: "EAE6DF" }),
              makeTableCell("Verification", { bold: true, shading: "EAE6DF" }),
            ],
          }),
          ...report.keyFindings.map(
            (item) =>
              new TableRow({
                children: [
                  makeTableCell(item.nodeType, { bold: true }),
                  makeTableCell(item.headline, { bold: true }),
                  makeTableCell(item.detail),
                  makeTableCell(item.status),
                ],
              }),
          ),
        ],
      }),
    );
  }

  // 3. Embedded Figures, Time-Series Projections & Empirical Charts
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [
        new TextRun({
          text: "3. Visual Figures, Time-Series Projections & Empirical Charts",
          bold: true,
          size: 30,
          color: "111319",
          font: "Georgia",
        }),
      ],
      spacing: { before: 320, after: 160 },
    }),
  );

  if (counterfactualPng && econModel.counterfactual) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new ImageRun({
            data: counterfactualPng.bytes,
            transformation: { width: 580, height: 222 },
            type: "png",
          }),
        ],
        spacing: { after: 80 },
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `Figure 1 — ${econModel.counterfactual.title}: `,
            bold: true,
            size: 19,
            color: "111319",
          }),
          new TextRun({
            text: `${econModel.counterfactual.subtitle}. Point estimate: ${econModel.scorecard.primaryMetricDelta} (${econModel.scorecard.elasticitySummary}).`,
            size: 19,
            color: "444754",
          }),
        ],
        spacing: { after: 220 },
      }),
    );
  }

  if (impulsePng && econModel.impulseResponse) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new ImageRun({
            data: impulsePng.bytes,
            transformation: { width: 580, height: 222 },
            type: "png",
          }),
        ],
        spacing: { after: 80 },
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `Figure 2 — ${econModel.impulseResponse.title}: `,
            bold: true,
            size: 19,
            color: "111319",
          }),
          new TextRun({
            text: `${econModel.impulseResponse.subtitle}. Peak response: ${econModel.scorecard.realOutputDelta} (${econModel.scorecard.timeToPeak}).`,
            size: 19,
            color: "444754",
          }),
        ],
        spacing: { after: 220 },
      }),
    );
  }

  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new ImageRun({
          data: mapPng.bytes,
          transformation: { width: 580, height: 245 },
          type: "png",
        }),
      ],
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: "Figure 3 — Policy Argument Knowledge Graph Blueprint: ",
          bold: true,
          size: 19,
          color: "111319",
        }),
        new TextRun({
          text: "Mapped across 01 Policy Rule, 02 Mechanism, 03 Core Finding, 04 Empirical Data, 05 Distributional Impact, and Digression Branches.",
          italics: true,
          size: 19,
          color: "555866",
        }),
      ],
      spacing: { after: 220 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new ImageRun({
          data: spinePng.bytes,
          transformation: { width: 580, height: 222 },
          type: "png",
        }),
      ],
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `Figure 4 — ${report.figureNotes[0]?.title ?? "Spine Coverage"}: `,
          bold: true,
          size: 19,
          color: "111319",
        }),
        new TextRun({
          text: `${report.figureNotes[0]?.caption ?? ""} ${report.figureNotes[0]?.interpretation ?? ""}`,
          size: 19,
          color: "444754",
        }),
      ],
      spacing: { after: 240 },
    }),
  );

  for (const item of fredPngs) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new ImageRun({
            data: item.png.bytes,
            transformation: { width: 580, height: 222 },
            type: "png",
          }),
        ],
        spacing: { after: 80 },
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `${item.note?.figureLabel ?? "FRED Series"} — ${item.series.title} (${item.series.seriesId}): `,
            bold: true,
            size: 19,
            color: "111319",
          }),
          new TextRun({
            text: `${item.note?.caption ?? ""} ${item.note?.interpretation ?? ""}`,
            size: 19,
            color: "444754",
          }),
        ],
        spacing: { after: 240 },
      }),
    );
  }

  // 4. Stage-by-Stage Policy Spine & Node Trace
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [
        new TextRun({
          text: "4. Stage-by-Stage Policy Spine Analysis & Node Trace",
          bold: true,
          size: 30,
          color: "111319",
          font: "Georgia",
        }),
      ],
      spacing: { before: 280, after: 140 },
    }),
  );

  for (const node of activeNodes) {
    const kindInfo = NODE_KIND_TAXONOMY[node.kind];
    const statusInfo = NODE_STATUS_TAXONOMY[node.status];
    const deepBody = analyses[node.id]?.body;
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [
          new TextRun({
            text: `${kindInfo.stage} · ${node.title} [${statusInfo.shortLabel}]`,
            bold: true,
            size: 24,
            color: "111319",
            font: "Georgia",
          }),
        ],
        spacing: { before: 180, after: 60 },
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `Node Role (${kindInfo.label}): `,
            bold: true,
            size: 19,
            color: "9A6B32",
          }),
          new TextRun({
            text: `${kindInfo.whatItDoes} `,
            italics: true,
            size: 19,
            color: "555866",
          }),
        ],
        spacing: { after: 60 },
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: node.body,
            bold: true,
            size: 21,
            color: "1E2028",
            font: "Calibri",
          }),
        ],
        spacing: { after: 100 },
      }),
    );

    if (deepBody) {
      for (const block of stripMarkdown(deepBody).split(/\n\n+/)) {
        if (!block.trim()) continue;
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: block.trim(),
                size: 20,
                color: "2C2F3A",
                font: "Calibri",
              }),
            ],
            spacing: { after: 110 },
          }),
        );
      }
    }
  }

  // 5. Distributional Incidence Matrix
  if (report.incidenceRows.length > 0) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [
          new TextRun({
            text: "5. Who Pays & Who Gains (Distributional Incidence Matrix)",
            bold: true,
            size: 30,
            color: "111319",
            font: "Georgia",
          }),
        ],
        spacing: { before: 280, after: 140 },
      }),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              makeTableCell("Affected Group / Channel", { bold: true, shading: "EAE6DF" }),
              makeTableCell("Role", { bold: true, shading: "EAE6DF" }),
              makeTableCell("Distributional Mechanism", { bold: true, shading: "EAE6DF" }),
              makeTableCell("Standing", { bold: true, shading: "EAE6DF" }),
            ],
          }),
          ...report.incidenceRows.map(
            (row) =>
              new TableRow({
                children: [
                  makeTableCell(row.group, { bold: true }),
                  makeTableCell(row.direction),
                  makeTableCell(row.mechanism),
                  makeTableCell(row.status),
                ],
              }),
          ),
        ],
      }),
    );
  }

  // 6. Methodology, Scope Contract & How This Output Was Made
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [
        new TextRun({
          text: "6. How This Output Was Made — Methodology & Provenance Trace",
          bold: true,
          size: 30,
          color: "111319",
          font: "Georgia",
        }),
      ],
      spacing: { before: 280, after: 140 },
    }),
  );

  for (const para of stripMarkdown(
    `${report.methodologyAndTrace}\n\n${report.risksAndCounterfactuals}`,
  ).split(/\n\n+/)) {
    if (!para.trim()) continue;
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: para.trim(),
            size: 21,
            color: "1E2028",
            font: "Calibri",
          }),
        ],
        spacing: { after: 140 },
      }),
    );
  }

  // 7. Full Verified Bibliography & MCP Span Register
  if (bibliography.length > 0) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [
          new TextRun({
            text: "7. Verified Bibliography & MCP Provenance Register",
            bold: true,
            size: 30,
            color: "111319",
            font: "Georgia",
          }),
        ],
        spacing: { before: 280, after: 140 },
      }),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              makeTableCell("#", { bold: true, shading: "EAE6DF" }),
              makeTableCell("Source Type", { bold: true, shading: "EAE6DF" }),
              makeTableCell("Citation & URL", { bold: true, shading: "EAE6DF" }),
              makeTableCell("Backed Nodes", { bold: true, shading: "EAE6DF" }),
              makeTableCell("Span Hash", { bold: true, shading: "EAE6DF" }),
            ],
          }),
          ...bibliography.map(
            (entry) =>
              new TableRow({
                children: [
                  makeTableCell(`[${entry.index}]`, { bold: true }),
                  makeTableCell(`${entry.kind} (${entry.source})`),
                  makeTableCell(
                    entry.url ? `${entry.label} (${entry.url})` : entry.label,
                  ),
                  makeTableCell(entry.nodeTitles.join(", ")),
                  makeTableCell(entry.spanId ?? "—"),
                ],
              }),
          ),
        ],
      }),
    );
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = slugFilename(report.title, "docx");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Generates and downloads a native multi-page PDF (.pdf) Policy Report with embedded charts & tables.
 */
export async function downloadPdfReport(bundle: FullReportBundle): Promise<void> {
  const { report, nodes, edges, analyses = {}, scope, fredSeries, bibliography } = bundle;
  const activeNodes = nodes.filter((n) => n.status !== "pruned");
  const econModel = buildRunEconomicModel({
    question: scope?.question ?? report.title,
    scope,
    nodes: activeNodes,
    fredSeries,
  });
  const counterfactualPng = econModel.counterfactual
    ? renderCounterfactualPng(econModel.counterfactual)
    : null;
  const impulsePng = econModel.impulseResponse
    ? renderImpulseResponsePng(econModel.impulseResponse)
    : null;
  const spinePng = renderSpineCoveragePng(activeNodes);
  const mapPng = renderArgumentMapPng(activeNodes, edges);
  const fredPngs = fredSeries.map((s, idx) => ({
    series: s,
    png: renderFredSeriesPng(s, idx + 4),
    note: report.figureNotes[idx + 1],
  }));

  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "pt", format: "letter" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 44;
  const contentW = pageW - margin * 2;
  let y = 44;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageH - 52) {
      pdf.addPage();
      y = 48;
    }
  };

  const writeSectionHeading = (title: string) => {
    ensureSpace(44);
    y += 10;
    pdf.setDrawColor(212, 180, 131);
    pdf.setLineWidth(1.2);
    pdf.line(margin, y, pageW - margin, y);
    y += 18;
    pdf.setFont("times", "bold");
    pdf.setFontSize(15);
    pdf.setTextColor(20, 22, 30);
    pdf.text(title, margin, y);
    y += 16;
  };

  const writeParagraph = (
    text: string,
    opts?: { bold?: boolean; size?: number; color?: [number, number, number] },
  ) => {
    const clean = stripMarkdown(text);
    if (!clean) return;
    pdf.setFont("helvetica", opts?.bold ? "bold" : "normal");
    const fontSize = opts?.size ?? 10.5;
    pdf.setFontSize(fontSize);
    const [r, g, b] = opts?.color ?? [35, 38, 48];
    pdf.setTextColor(r, g, b);
    const lines = pdf.splitTextToSize(clean, contentW) as string[];
    const lineH = fontSize * 1.42;
    for (const line of lines) {
      ensureSpace(lineH + 4);
      pdf.text(line, margin, y);
      y += lineH;
    }
    y += 6;
  };

  // Cover Header Banner
  pdf.setFillColor(15, 17, 23);
  pdf.rect(0, 0, pageW, 132, "F");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.setTextColor(212, 180, 131);
  pdf.text(
    `POLINOTE POLICY RESEARCH REPORT · ${report.projectTitle.toUpperCase()}`,
    margin,
    36,
  );

  pdf.setFont("times", "bold");
  pdf.setFontSize(20);
  pdf.setTextColor(243, 238, 228);
  const titleLines = pdf.splitTextToSize(report.title, contentW) as string[];
  pdf.text(titleLines.slice(0, 2), margin, 62);

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.setTextColor(175, 168, 156);
  pdf.text(
    `${report.subtitle.slice(0, 88)} · ${new Date(report.preparedAt).toLocaleDateString()}`,
    margin,
    112,
  );

  y = 156;

  // 1. Executive Summary
  writeSectionHeading("1. Executive Summary");
  for (const para of report.executiveSummary.split(/\n\n+/)) {
    writeParagraph(para);
  }

  // 2. Key Policy Findings
  if (report.keyFindings.length > 0) {
    writeSectionHeading("2. Key Policy Findings & Node Roles");
    for (const item of report.keyFindings) {
      ensureSpace(48);
      writeParagraph(
        `• [${item.nodeType} · ${item.status}] ${item.headline}`,
        { bold: true, size: 10.5, color: [154, 107, 50] },
      );
      writeParagraph(item.detail, { size: 10 });
    }
  }

  // 3. Embedded Figures & Charts
  writeSectionHeading("3. Visual Figures, Argument Map & Empirical FRED Charts");

  const embedPngFigure = (
    png: RenderedPng,
    captionTitle: string,
    captionBody: string,
  ) => {
    const imgH = (png.height / png.width) * contentW;
    ensureSpace(imgH + 54);
    pdf.addImage(png.dataUrl, "PNG", margin, y, contentW, imgH);
    y += imgH + 14;
    writeParagraph(captionTitle, {
      bold: true,
      size: 9.5,
      color: [20, 22, 30],
    });
    writeParagraph(captionBody, { size: 9, color: [85, 88, 102] });
  };

  if (counterfactualPng && econModel.counterfactual) {
    embedPngFigure(
      counterfactualPng,
      `Figure 1 — ${econModel.counterfactual.title}`,
      `${econModel.counterfactual.subtitle}. Point estimate: ${econModel.scorecard.primaryMetricDelta} (${econModel.scorecard.elasticitySummary}).`,
    );
  }

  if (impulsePng && econModel.impulseResponse) {
    embedPngFigure(
      impulsePng,
      `Figure 2 — ${econModel.impulseResponse.title}`,
      `${econModel.impulseResponse.subtitle}. Peak response: ${econModel.scorecard.realOutputDelta} (${econModel.scorecard.timeToPeak}).`,
    );
  }

  embedPngFigure(
    mapPng,
    "Figure 3 — Policy Argument Knowledge Graph Blueprint",
    "Visual trace across 01 Policy Rule, 02 Mechanism, 03 Core Finding, 04 Empirical Data, 05 Distributional Impact, and Digression Branches.",
  );

  embedPngFigure(
    spinePng,
    `Figure 4 — ${report.figureNotes[0]?.title ?? "Spine Coverage"}`,
    `${report.figureNotes[0]?.caption ?? ""} ${report.figureNotes[0]?.interpretation ?? ""}`,
  );

  for (const item of fredPngs) {
    embedPngFigure(
      item.png,
      `${item.note?.figureLabel ?? "FRED Series"} — ${item.series.title} (${item.series.seriesId})`,
      `${item.note?.caption ?? ""} ${item.note?.interpretation ?? ""}`,
    );
  }

  // 4. Stage-by-Stage Policy Spine & Node Trace
  writeSectionHeading("4. Stage-by-Stage Policy Spine & Node-by-Node Trace");
  for (const node of activeNodes) {
    const kindInfo = NODE_KIND_TAXONOMY[node.kind];
    const statusInfo = NODE_STATUS_TAXONOMY[node.status];
    const deepBody = analyses[node.id]?.body;
    ensureSpace(58);
    writeParagraph(
      `${kindInfo.stage} · ${node.title} (${statusInfo.label})`,
      { bold: true, size: 11, color: [20, 22, 30] },
    );
    writeParagraph(
      `What this node is (${kindInfo.label}): ${kindInfo.whatItDoes}`,
      { size: 9.5, color: [154, 107, 50] },
    );
    writeParagraph(node.body, { bold: true, size: 10 });
    if (deepBody) {
      for (const block of deepBody.split(/\n\n+/)) {
        writeParagraph(block, { size: 9.8, color: [48, 52, 64] });
      }
    }
  }

  // 5. Methodology & How Output Was Made
  writeSectionHeading("5. How This Output Was Made — Methodology & Provenance");
  for (const para of `${report.methodologyAndTrace}\n\n${report.risksAndCounterfactuals}`.split(
    /\n\n+/,
  )) {
    writeParagraph(para, { size: 10 });
  }

  // 6. Verified Bibliography & MCP Spans
  if (bibliography.length > 0) {
    writeSectionHeading("6. Verified Bibliography & MCP Provenance Register");
    for (const entry of bibliography) {
      writeParagraph(
        `[${entry.index}] (${entry.kind} · ${entry.source}) ${entry.label}${entry.url ? ` — ${entry.url}` : ""} | Backed Nodes: ${entry.nodeTitles.join(", ")}${entry.spanId ? ` | Span: ${entry.spanId}` : ""}`,
        { size: 9.2, color: [45, 48, 58] },
      );
    }
  }

  // Page numbers
  const pageCount = pdf.getNumberOfPages();
  for (let p = 1; p <= pageCount; p += 1) {
    pdf.setPage(p);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8.5);
    pdf.setTextColor(130, 130, 140);
    pdf.text(
      `PoliNote Policy Research Report · ${report.title.slice(0, 56)} · Page ${p} of ${pageCount}`,
      margin,
      pageH - 22,
    );
  }

  pdf.save(slugFilename(report.title, "pdf"));
}
