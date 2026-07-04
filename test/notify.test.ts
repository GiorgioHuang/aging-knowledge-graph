import { test } from "node:test";
import assert from "node:assert/strict";
import { formatContactNotice, telegramConfigured, notifyContact } from "../src/notify.ts";

test("formatContactNotice renders name/email/message with fallbacks", () => {
  const t = formatContactNotice({ id: 7, name: "Ada", email: "a@b.co", message: "  hello  ", ip: "203.0.113.7", userAgent: "curl/8" });
  assert.match(t, /New contact message/);
  assert.match(t, /From: Ada/);
  assert.match(t, /Email: a@b\.co/);
  assert.match(t, /hello/);
  assert.match(t, /IP: 203\.0\.113\.7/);
  assert.match(t, /UA: curl\/8/);
  assert.match(t, /#7/);

  const anon = formatContactNotice({ message: "hi" });
  assert.match(anon, /From: \(anonymous\)/);
  assert.match(anon, /Email: \(none\)/);
});

test("telegramConfigured + notifyContact are false/no-op without config", async () => {
  const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  try {
    assert.equal(telegramConfigured(), false);
    // No network is touched when unconfigured; it just returns false.
    assert.equal(await notifyContact({ message: "hi" }), false);
  } finally {
    if (TELEGRAM_BOT_TOKEN !== undefined) process.env.TELEGRAM_BOT_TOKEN = TELEGRAM_BOT_TOKEN;
    if (TELEGRAM_CHAT_ID !== undefined) process.env.TELEGRAM_CHAT_ID = TELEGRAM_CHAT_ID;
  }
});
