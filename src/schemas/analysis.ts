import { z } from "zod";

export const AnalysisCitationSchema = z.object({
  title: z.string().min(1),
  url: z.string().url().optional(),
  note: z.string().optional(),
});

export type AnalysisCitation = z.infer<typeof AnalysisCitationSchema>;

export const NodeAnalysisSchema = z.object({
  nodeId: z.string().min(1),
  runId: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1),
  citations: z.array(AnalysisCitationSchema).default([]),
});

export type NodeAnalysis = z.infer<typeof NodeAnalysisSchema>;
