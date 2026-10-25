import { MCP_SERVERS, type McpServerName } from "@/mcp/servers";
import { toTypedApiError } from "@/lib/env";
import { mcpConfigured, toolsForServer } from "@/lib/mcp/catalog";
import { redactSecrets } from "@/lib/mcp/http";
import { ensureMcpTools } from "@/lib/mcp/register";
import { getSessionUserId, SessionForbiddenError } from "@/lib/session";
import { callTool, type ToolName } from "@/tools/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ server: string }> };

function isServer(value: string): value is McpServerName {
  return (MCP_SERVERS as readonly string[]).includes(value);
}

function redact(value: string): string {
  return redactSecrets(value);
}

export async function GET(_request: Request, ctx: RouteCtx) {
  try {
    await getSessionUserId();
    const { server } = await ctx.params;
    if (!isServer(server)) {
      return Response.json({ error: "Unknown MCP server" }, { status: 404 });
    }
    ensureMcpTools();
    return Response.json({
      server,
      tools: toolsForServer(server),
      configured: mcpConfigured(),
    });
  } catch (error) {
    const typed = toTypedApiError(error, "mcp");
    return Response.json(
      { error: typed.message, errorDetail: typed },
      { status: typed.status },
    );
  }
}

export async function POST(request: Request, ctx: RouteCtx) {
  try {
    const userId = await getSessionUserId();
    const { server } = await ctx.params;
    if (!isServer(server)) {
      return Response.json({ error: "Unknown MCP server" }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as {
      tool?: unknown;
      args?: unknown;
    } | null;
    const tool = typeof body?.tool === "string" ? body.tool : "";
    const allowed = toolsForServer(server);
    if (!allowed.includes(tool as ToolName)) {
      return Response.json({ error: "Unknown tool for this server" }, { status: 400 });
    }

    const args =
      body?.args && typeof body.args === "object" && !Array.isArray(body.args)
        ? { ...(body.args as Record<string, unknown>) }
        : {};

    if (typeof args.userId === "string" && args.userId.trim() && args.userId.trim() !== userId) {
      throw new SessionForbiddenError(
        "Forbidden: args.userId does not match the signed session cookie.",
      );
    }

    if (server === "workspace" || server === "trace") {
      args.userId = userId;
    }

    ensureMcpTools();
    const result = await callTool(tool as ToolName, args);
    return Response.json({
      ok: result.ok,
      data: result.data ?? null,
      error: result.error ? redact(result.error) : undefined,
      spanId: result.spanId,
    });
  } catch (error) {
    const typed = toTypedApiError(error, "mcp");
    return Response.json(
      { error: typed.message, errorDetail: typed },
      { status: typed.status },
    );
  }
}
