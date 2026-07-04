import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const mcpPath = join(here, "..", "src", "mcp.ts");

/** Send a sequence of JSON-RPC requests over stdio; collect the responses. */
function rpc(requests: object[]): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", ["--experimental-strip-types", mcpPath], { stdio: ["pipe", "pipe", "inherit"] });
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("close", () => {
      const msgs = out.split("\n").filter(Boolean).map((l) => JSON.parse(l));
      resolve(msgs);
    });
    for (const r of requests) child.stdin.write(JSON.stringify(r) + "\n");
    child.stdin.end();
  });
}

test("MCP initialize + tools/list + tools/call", async () => {
  const msgs = await rpc([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "graceage_what_affects", arguments: { object: "ga:fall-rate", protective: true } } },
  ]);

  const init = msgs.find((m) => m.id === 1);
  assert.ok(init.result.serverInfo.name === "graceage-knowledge");
  assert.deepEqual(init.result.capabilities.tools, {});

  const list = msgs.find((m) => m.id === 2);
  const toolNames = list.result.tools.map((t: { name: string }) => t.name);
  assert.ok(toolNames.includes("graceage_what_affects"));
  assert.ok(toolNames.includes("graceage_conflicts"));

  const call = msgs.find((m) => m.id === 3);
  const payload = JSON.parse(call.result.content[0].text);
  assert.ok(payload.some((r: { subject: string; certainty: string }) => r.subject === "Exercise (physical activity)" && r.certainty === "high"));
});

test("MCP unknown tool returns an error", async () => {
  const msgs = await rpc([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "graceage_nope", arguments: {} } },
  ]);
  const call = msgs.find((m) => m.id === 2);
  assert.ok(call.error && /unknown tool/.test(call.error.message));
});
