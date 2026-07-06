// Healthy Aging Knowledge — runtime settings (key/value in the existing `meta` table).
// Used to switch each agent's model at runtime without a redeploy: a value set
// here overrides the env default, and the agents read it at the start of every
// cycle, so a change takes effect on the next scheduled run.

import { isDbConfigured, getSql } from "./db.ts";
import { AGENTS, DEFAULT_MODEL, KNOWN_MODELS, type AgentName, type ModelInfo, envKeyFor, envModelFor, normalizeModel } from "./models.ts";

const modelKey = (a: AgentName) => `model:${a}`;

export async function getSetting(key: string): Promise<string | undefined> {
  if (!isDbConfigured()) return undefined;
  try {
    const sql = await getSql();
    const rows = (await sql.query("SELECT value FROM meta WHERE key=$1", [key])) as { value: string }[];
    return rows[0]?.value;
  } catch {
    return undefined; // meta table may not exist yet
  }
}

export async function setSetting(key: string, value: string | null): Promise<void> {
  const sql = await getSql();
  await sql.query("CREATE TABLE IF NOT EXISTS meta (key text PRIMARY KEY, value text)");
  if (value === null) await sql.query("DELETE FROM meta WHERE key=$1", [key]);
  else await sql.query("INSERT INTO meta (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [key, value]);
}

/** Effective model for an agent: DB override > per-agent env > global env > default. */
export async function resolveAgentModel(agent: AgentName): Promise<string> {
  return normalizeModel(await getSetting(modelKey(agent))) ?? envModelFor(agent);
}

/** Set (or clear, with null) an agent's model override in the DB. */
export async function setAgentModel(agent: AgentName, model: string | null): Promise<void> {
  await setSetting(modelKey(agent), model ? model.trim() : null);
}

export interface AgentModelRow {
  agent: AgentName;
  model: string;
  source: "db" | "env" | "default";
  dbValue?: string;
  envValue?: string;
}
export interface AgentModelConfig {
  agents: AgentModelRow[];
  default: string;
  known: ModelInfo[];
  dbAvailable: boolean;
}

/** Snapshot for the API/UI: each agent's effective model and where it came from. */
export async function agentModelConfig(): Promise<AgentModelConfig> {
  const agents: AgentModelRow[] = [];
  for (const a of AGENTS) {
    const dbValue = normalizeModel(await getSetting(modelKey(a)));
    const envValue = normalizeModel(process.env[envKeyFor(a)]) ?? normalizeModel(process.env.ANTHROPIC_MODEL);
    let model = DEFAULT_MODEL;
    let source: AgentModelRow["source"] = "default";
    if (dbValue) { model = dbValue; source = "db"; }
    else if (envValue) { model = envValue; source = "env"; }
    agents.push({ agent: a, model, source, dbValue, envValue });
  }
  return { agents, default: DEFAULT_MODEL, known: KNOWN_MODELS, dbAvailable: isDbConfigured() };
}
