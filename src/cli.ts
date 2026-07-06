// Healthy Aging Knowledge — V0 CLI.
//   node --experimental-strip-types src/cli.ts validate
//   node --experimental-strip-types src/cli.ts query what_affects ga:fall-rate --protective
//   node --experimental-strip-types src/cli.ts query conflicts
//   node --experimental-strip-types src/cli.ts query list_nodes --type=outcome

import { loadGraph, validate } from "./model.ts";
import { loadGraphAsync } from "./store.ts";
import { registry, byName } from "./registry.ts";

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

const [, , cmd, ...args] = process.argv;
const g = cmd === "validate" ? loadGraph() : await loadGraphAsync();

if (cmd === "validate") {
  const r = validate(g);
  for (const w of r.warnings) console.warn(`warning: ${w}`);
  for (const e of r.errors) console.error(`error:   ${e}`);
  console.log(
    `\n${r.errors.length === 0 ? "OK" : "FAILED"} — ` +
      `${r.counts.nodes} nodes, ${r.counts.claims} claims, ${r.counts.evidence} evidence, ` +
      `${r.counts.contradictions} contradictions; ${r.warnings.length} warning(s), ${r.errors.length} error(s).`,
  );
  process.exit(r.errors.length === 0 ? 0 : 1);
}

if (cmd === "query") {
  const name = args[0];
  if (!name) die(`usage: cli.ts query <name>. available: ${registry.map((d) => d.name).join(", ")}`);
  const def = byName.get(name);
  if (!def) die(`unknown query '${name}'. available: ${registry.map((d) => d.name).join(", ")}`);
  // positional args fill the schema's required fields in order; --flags set named args.
  const flags = args.slice(1).filter((a) => a.startsWith("--"));
  const positional = args.slice(1).filter((a) => !a.startsWith("--"));
  const queryArgs: Record<string, unknown> = {};
  (def.inputSchema.required ?? []).forEach((key, i) => {
    if (positional[i] !== undefined) queryArgs[key] = positional[i];
  });
  for (const f of flags) {
    const [k, v] = f.slice(2).split("=");
    queryArgs[k] = v === undefined ? true : v;
  }
  console.log(JSON.stringify(await def.run(g, queryArgs), null, 2));
  process.exit(0);
}

die("usage: cli.ts <validate|query> [...]");
