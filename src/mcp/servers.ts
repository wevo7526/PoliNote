/**
 * In-app MCP servers (Streamable HTTP via mcp-handler).
 * Routes live under src/app/api/mcp/* and wrap src/tools/registry.
 *
 * Planned endpoints:
 *   /api/mcp/econ-series
 *   /api/mcp/policy-docs
 *   /api/mcp/literature
 *   /api/mcp/workspace
 *   /api/mcp/trace
 */

export const MCP_SERVERS = [
  "econ-series",
  "policy-docs",
  "literature",
  "workspace",
  "trace",
] as const;

export type McpServerName = (typeof MCP_SERVERS)[number];
