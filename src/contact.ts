// Healthy Aging Knowledge — contact form storage.
// Public visitors POST a message from the About page; it is stored in Postgres.
// There is no email provider wired up, so the maintainer reads submissions via
// the token-gated GET /contact/messages endpoint. The table is (re)created
// lazily so a deployment provisioned before migration 0004 gets it on first
// write — mirroring how settings.ts treats the `meta` table.

import { isDbConfigured, getSql } from "./db.ts";

export interface ContactInput { name?: string; email?: string; message: string; userAgent?: string }
export interface ContactMessage extends ContactInput { id: number; handled: boolean; created_at: string }

export const CONTACT_LIMITS = { name: 120, email: 160, message: 4000 };

/** Validate + normalize a raw request body. Pure (no DB), so it is unit-tested
 *  and lets the HTTP layer reject bad input with 400 before touching the DB. */
export function validateContact(body: unknown): { ok: true; value: ContactInput } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const name = str(b.name), email = str(b.email), message = str(b.message);
  if (!message) return { ok: false, error: "message is required" };
  if (message.length > CONTACT_LIMITS.message) return { ok: false, error: `message is too long (max ${CONTACT_LIMITS.message} characters)` };
  if (name.length > CONTACT_LIMITS.name) return { ok: false, error: "name is too long" };
  if (email.length > CONTACT_LIMITS.email) return { ok: false, error: "email is too long" };
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "email address looks invalid" };
  return { ok: true, value: { name: name || undefined, email: email || undefined, message } };
}

const DDL = `CREATE TABLE IF NOT EXISTS contact_message (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text, email text, message text NOT NULL, user_agent text,
  handled boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now())`;

export async function saveContactMessage(input: ContactInput): Promise<{ id: number }> {
  const sql = await getSql();
  await sql.query(DDL);
  const rows = (await sql.query(
    "INSERT INTO contact_message (name,email,message,user_agent) VALUES ($1,$2,$3,$4) RETURNING id",
    [input.name ?? null, input.email ?? null, input.message, input.userAgent ?? null],
  )) as { id: number }[];
  return { id: rows[0].id };
}

/** Newest-first submissions, for the maintainer (token-gated at the HTTP layer). */
export async function listContactMessages(limit = 100): Promise<ContactMessage[]> {
  if (!isDbConfigured()) return [];
  const sql = await getSql();
  await sql.query(DDL);
  const n = Math.min(Math.max(1, Math.floor(limit)), 500);
  return (await sql.query(
    "SELECT id,name,email,message,user_agent,handled,created_at FROM contact_message ORDER BY created_at DESC LIMIT $1",
    [n],
  )) as ContactMessage[];
}
