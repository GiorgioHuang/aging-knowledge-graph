// Healthy Aging Knowledge — Neon Postgres access.
// The driver (@neondatabase/serverless) is imported DYNAMICALLY and only when a
// DATABASE_URL is configured, so the offline seed path needs no dependency and
// `npm test` runs without installing anything.

export function isDbConfigured(): boolean {
  return typeof process.env.DATABASE_URL === "string" && process.env.DATABASE_URL.length > 0;
}

/** A minimal tagged-template SQL function backed by Neon's HTTP driver. */
export type Sql = <T = Record<string, unknown>>(strings: TemplateStringsArray, ...params: unknown[]) => Promise<T[]>;

let cached: Sql | undefined;

export async function getSql(): Promise<Sql> {
  if (!isDbConfigured()) throw new Error("DATABASE_URL is not set");
  if (cached) return cached;
  const { neon } = await import("@neondatabase/serverless");
  cached = neon(process.env.DATABASE_URL as string) as unknown as Sql;
  return cached;
}
