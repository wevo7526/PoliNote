import type { McpServerName } from "@/mcp/servers";
import type { ToolName } from "@/tools/registry";

export const SERVER_TOOLS: Record<McpServerName, ToolName[]> = {
  "econ-series": [
    "econ.search_series",
    "econ.get_observations",
    "econ.get_vintage",
  ],
  literature: ["lit.search"],
  "policy-docs": ["policy.search"],
  workspace: ["workspace.read_memo", "workspace.write_memo"],
  trace: ["trace.get_run", "trace.get_span", "trace.replay_from_span"],
};

export function toolsForServer(server: McpServerName): ToolName[] {
  return SERVER_TOOLS[server];
}

export function serverForTool(tool: ToolName): McpServerName | null {
  for (const [server, tools] of Object.entries(SERVER_TOOLS) as Array<
    [McpServerName, ToolName[]]
  >) {
    if (tools.includes(tool)) return server;
  }
  return null;
}

export function mcpConfigured(): {
  fred: boolean;
  congress: boolean;
  firecrawl: boolean;
} {
  return {
    fred: Boolean(process.env.FRED_API_KEY?.trim()),
    congress: Boolean(process.env.CONGRESS_API_KEY?.trim()),
    firecrawl: Boolean(process.env.FIRECRAWL_API_KEY?.trim()),
  };
}
