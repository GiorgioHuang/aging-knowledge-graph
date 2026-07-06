// Healthy Aging Knowledge — outbound notifications (Telegram) for new contact
// messages. Best-effort: nothing here throws into the request path. The message
// is already persisted in Postgres before we notify, so a Telegram outage just
// means no push (the maintainer can still read it via /contact/messages).
//
// Config (mounted from Secret Manager on Cloud Run):
//   TELEGRAM_BOT_TOKEN  — the bot token from @BotFather
//   TELEGRAM_CHAT_ID    — the chat/channel id to deliver to

const TELEGRAM_API = "https://api.telegram.org";

export interface ContactNotice { id?: number; name?: string; email?: string; message: string; userAgent?: string; ip?: string }

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

/** Render a plain-text Telegram message (no parse_mode, so user-supplied text
 *  can't inject Markdown/HTML). Pure — unit-tested. */
export function formatContactNotice(n: ContactNotice): string {
  const lines = [
    "📬 New contact message — Healthy Aging Knowledge",
    `From: ${n.name?.trim() || "(anonymous)"}`,
    `Email: ${n.email?.trim() || "(none)"}`,
    "",
    n.message.trim(),
  ];
  const meta: string[] = [];
  if (n.ip) meta.push(`IP: ${n.ip}`);
  if (n.userAgent) meta.push(`UA: ${n.userAgent}`);
  if (meta.length) lines.push("", ...meta);
  if (n.id != null) lines.push(`#${n.id}`);
  return lines.join("\n");
}

/** Push a new contact message to Telegram. Resolves true on success, false if
 *  unconfigured or the send failed. Never throws; bounded by a timeout so it
 *  can be awaited inside the request without hanging it. */
export async function notifyContact(n: ContactNotice, timeoutMs = 6000): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: formatContactNotice(n), disable_web_page_preview: true }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.error(`telegram notify failed: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`telegram notify error: ${(err as Error).message}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}
