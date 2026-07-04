import { test } from "node:test";
import assert from "node:assert/strict";
import { validateContact, CONTACT_LIMITS } from "../src/contact.ts";

test("validateContact requires a non-empty message", () => {
  assert.equal(validateContact({}).ok, false);
  assert.equal(validateContact({ message: "   " }).ok, false);
  const r = validateContact({ message: "  hello there  " });
  assert.ok(r.ok && r.value.message === "hello there");
});

test("validateContact trims optional name/email and drops blanks", () => {
  const r = validateContact({ name: "  Ada  ", email: "", message: "hi" });
  assert.ok(r.ok);
  assert.equal(r.value.name, "Ada");
  assert.equal(r.value.email, undefined);
});

test("validateContact rejects malformed email and over-long fields", () => {
  assert.equal(validateContact({ email: "not-an-email", message: "hi" }).ok, false);
  assert.equal(validateContact({ email: "a@b.co", message: "hi" }).ok, true);
  assert.equal(validateContact({ message: "x".repeat(CONTACT_LIMITS.message + 1) }).ok, false);
  assert.equal(validateContact({ name: "x".repeat(CONTACT_LIMITS.name + 1), message: "hi" }).ok, false);
});
