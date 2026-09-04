/**
 * Shared TypeScript tool registry.
 * MCP route handlers wrap these same functions (no self-HTTP for in-app agents).
 * Filled in later phases (econ-series / literature / policy-docs / workspace / trace).
 */

export type ToolName =
  | "econ.search_series"
  | "econ.get_observations"
  | "econ.get_vintage"
  | "lit.search"
  | "policy.search"
  | "workspace.read_memo"
  | "workspace.write_memo"
  | "trace.get_run"
  | "trace.get_span"
  | "trace.replay_from_span";

export type ToolResult<T = unknown> = {
  ok: boolean;
  data?: T;
  error?: string;
  /** Domain span id for event log / provenance chips. */
  spanId?: string;
};

export type ToolHandler = (
  args: Record<string, unknown>,
) => Promise<ToolResult>;

const registry = new Map<ToolName, ToolHandler>();

export function registerTool(name: ToolName, handler: ToolHandler): void {
  registry.set(name, handler);
}

export function getTool(name: ToolName): ToolHandler | undefined {
  return registry.get(name);
}

export function listTools(): ToolName[] {
  return [...registry.keys()];
}

export async function callTool(
  name: ToolName,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const handler = registry.get(name);
  if (!handler) {
    return { ok: false, error: `Tool not registered: ${name}` };
  }
  return handler(args);
}
