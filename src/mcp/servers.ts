/**
 * In-app MCP servers. JSON routes at /api/mcp/[server] wrap src/tools/registry.
 * In-app agents call the registry directly — they do not HTTP themselves.
 */

export const MCP_SERVERS = [
  "econ-series",
  "policy-docs",
  "literature",
  "workspace",
  "trace",
] as const;

export type McpServerName = (typeof MCP_SERVERS)[number];
