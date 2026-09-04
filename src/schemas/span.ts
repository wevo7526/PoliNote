import { z } from "zod";
import type { McpServerName } from "@/mcp/servers";

export const EvidenceSpanSchema = z.object({
  id: z.string().min(1),
  server: z.enum([
    "econ-series",
    "policy-docs",
    "literature",
    "workspace",
    "trace",
  ]),
  tool: z.string().min(1),
  citation: z.string().min(1),
  url: z.string().url().optional(),
  seriesId: z.string().optional(),
  frequency: z.string().optional(),
  units: z.string().optional(),
  vintage: z.string().optional(),
  resultHash: z.string().min(1),
});

export type EvidenceSpan = z.infer<typeof EvidenceSpanSchema>;

export function isMcpServer(value: string): value is McpServerName {
  return (
    value === "econ-series" ||
    value === "policy-docs" ||
    value === "literature" ||
    value === "workspace" ||
    value === "trace"
  );
}
