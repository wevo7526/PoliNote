import type { ExtractedSeries, BibliographyEntry } from "@/components/studio/ReportCharts";
import type { DigressionEdge, DigressionNode } from "@/schemas/digression";
import type { ScopeContract } from "@/schemas/scope-contract";

export type ReportFindingItem = {
  nodeType: string;
  headline: string;
  detail: string;
  status: string;
  citationRef: string;
};

export type ReportFigureNote = {
  figureLabel: string;
  title: string;
  caption: string;
  interpretation: string;
};

export type ReportIncidenceRow = {
  group: string;
  direction: string;
  mechanism: string;
  status: string;
};

export type CompiledPolicyReport = {
  title: string;
  subtitle: string;
  projectTitle: string;
  preparedAt: string;
  executiveSummary: string;
  keyFindings: ReportFindingItem[];
  spineNarrative: string;
  figureNotes: ReportFigureNote[];
  incidenceRows: ReportIncidenceRow[];
  methodologyAndTrace: string;
  risksAndCounterfactuals: string;
};

export type FullReportBundle = {
  report: CompiledPolicyReport;
  nodes: DigressionNode[];
  edges: DigressionEdge[];
  scope: ScopeContract | null;
  fredSeries: ExtractedSeries[];
  bibliography: BibliographyEntry[];
};
