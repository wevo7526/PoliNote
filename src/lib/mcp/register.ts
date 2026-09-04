import { getObservations, getVintage, searchSeries } from "@/lib/mcp/fred";
import { searchLiterature } from "@/lib/mcp/openalex";
import { searchPolicy } from "@/lib/mcp/policy-docs";
import { getRunTrace, getSpan, replayFromSpan } from "@/lib/mcp/trace";
import { readMemo, writeMemo } from "@/lib/mcp/workspace";
import { listTools, registerTool } from "@/tools/registry";

let registered = false;

export function ensureMcpTools(): void {
  if (registered && listTools().length > 0) return;
  registerTool("econ.search_series", searchSeries);
  registerTool("econ.get_observations", getObservations);
  registerTool("econ.get_vintage", getVintage);
  registerTool("lit.search", searchLiterature);
  registerTool("policy.search", searchPolicy);
  registerTool("workspace.read_memo", readMemo);
  registerTool("workspace.write_memo", writeMemo);
  registerTool("trace.get_run", getRunTrace);
  registerTool("trace.get_span", getSpan);
  registerTool("trace.replay_from_span", replayFromSpan);
  registered = true;
}
