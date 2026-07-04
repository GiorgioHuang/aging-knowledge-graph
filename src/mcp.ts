// GraceAge Knowledge — MCP server over stdio (newline-delimited JSON-RPC 2.0).
// Handling is shared with the HTTP transport via src/mcp-core.ts.
//   node --experimental-strip-types src/mcp.ts
import { loadGraphAsync } from "./store.ts";
import { handleRpc, fail, type RpcRequest, type RpcResult } from "./mcp-core.ts";

const g = await loadGraphAsync();

function write(msg: RpcResult): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  let nl: number;
  while ((nl = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let req: RpcRequest;
    try {
      req = JSON.parse(line);
    } catch {
      write(fail(null, -32700, "parse error"));
      continue;
    }
    void handleRpc(g, req).then((out) => { if (out) write(out); });
  }
});
process.stdin.on("end", () => process.exit(0));
