import { test } from "node:test";
import assert from "node:assert/strict";
import { supportsAdaptiveThinking, envModelFor, normalizeModel, DEFAULT_MODEL, KNOWN_MODELS } from "../src/models.ts";

test("DEFAULT_MODEL is Opus 4.8 and is in the known list; Opus 5 is selectable", () => {
  assert.equal(DEFAULT_MODEL, "claude-opus-4-8");
  assert.ok(KNOWN_MODELS.some((m) => m.id === DEFAULT_MODEL));
  assert.ok(KNOWN_MODELS.some((m) => m.id === "claude-opus-5"), "Opus 5 is a known model");
});

test("supportsAdaptiveThinking covers the 4.6+/Fable family, omits older/unknown", () => {
  for (const m of ["claude-opus-5", "claude-sonnet-5", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-sonnet-4-6", "claude-fable-5"])
    assert.equal(supportsAdaptiveThinking(m), true, m);
  // Haiku 4.5 does NOT support adaptive thinking (confirmed via the live API).
  for (const m of ["claude-haiku-4-5", "claude-3-haiku-20240307", "claude-3-5-haiku", "gpt-4", "", "some-future-model"])
    assert.equal(supportsAdaptiveThinking(m), false, m);
});

test("envModelFor precedence: per-agent env > global env > default", () => {
  assert.equal(envModelFor("curator", {}), DEFAULT_MODEL);
  assert.equal(envModelFor("curator", { ANTHROPIC_MODEL: "claude-sonnet-4-6" }), "claude-sonnet-4-6");
  assert.equal(envModelFor("curator", { ANTHROPIC_MODEL: "claude-sonnet-4-6", CURATOR_MODEL: "claude-haiku-4-5" }), "claude-haiku-4-5");
  // per-agent isolation: reviewer unaffected by CURATOR_MODEL
  assert.equal(envModelFor("reviewer", { CURATOR_MODEL: "claude-haiku-4-5" }), DEFAULT_MODEL);
  assert.equal(envModelFor("reviewer", { REVIEWER_MODEL: "claude-fable-5" }), "claude-fable-5");
});

test("normalizeModel trims and treats blank as undefined", () => {
  assert.equal(normalizeModel("  claude-opus-4-8  "), "claude-opus-4-8");
  assert.equal(normalizeModel("   "), undefined);
  assert.equal(normalizeModel(undefined), undefined);
});
