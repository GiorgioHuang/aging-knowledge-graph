// Healthy Aging Knowledge — MCP request handling, shared by the stdio server
// (src/mcp.ts) and the HTTP transport (POST /mcp in src/http.ts).
import { registry, byName } from "./registry.ts";
import type { Graph } from "./types.ts";

export const SERVER = { name: "graceage-knowledge", version: "0.0.0" };
const DEFAULT_PROTOCOL = "2025-06-18";
export const TOOL_PREFIX = "graceage_";

export interface RpcRequest { jsonrpc: "2.0"; id?: number | string | null; method: string; params?: any }
export type RpcResult = { jsonrpc: "2.0"; id: number | string | null; result?: unknown; error?: { code: number; message: string } };

export function reply(id: number | string | null, result: unknown): RpcResult {
  return { jsonrpc: "2.0", id, result };
}
export function fail(id: number | string | null, code: number, message: string): RpcResult {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/** Handle one JSON-RPC request. Returns null for notifications (no response). */
export async function handleRpc(g: Graph, req: RpcRequest): Promise<RpcResult | null> {
  const id = req.id ?? null;
  switch (req.method) {
    case "initialize":
      return reply(id, {
        protocolVersion: req.params?.protocolVersion ?? DEFAULT_PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: SERVER,
      });
    case "notifications/initialized":
    case "initialized":
      return null;
    case "ping":
      return reply(id, {});
    case "tools/list":
      return reply(id, {
        tools: registry.map((d) => ({ name: `${TOOL_PREFIX}${d.name}`, description: d.description, inputSchema: d.inputSchema })),
      });
    case "tools/call": {
      const toolName = String(req.params?.name ?? "");
      const def = byName.get(toolName.startsWith(TOOL_PREFIX) ? toolName.slice(TOOL_PREFIX.length) : toolName);
      if (!def) return fail(id, -32602, `unknown tool '${toolName}'`);
      try {
        const result = await def.run(g, (req.params?.arguments ?? {}) as Record<string, unknown>);
        return reply(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
      } catch (err) {
        return reply(id, { isError: true, content: [{ type: "text", text: (err as Error).message }] });
      }
    }
    default:
      return req.id === undefined ? null : fail(id, -32601, `method not found: ${req.method}`);
  }
}
