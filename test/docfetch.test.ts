import { test } from "node:test";
import assert from "node:assert/strict";
import { htmlToText } from "../src/docfetch.ts";

test("htmlToText extracts the article body and drops nav/footer boilerplate", async () => {
  const html = `<html><head><title>Falls Guideline</title></head><body>
    <nav>home about contact menu junk</nav>
    <article><h1>Falls prevention in older adults</h1>
      <p>We recommend offering structured exercise programmes to community-dwelling older adults to reduce the rate of falls. This is a strong recommendation based on high-certainty evidence from randomized controlled trials.</p>
      <p>Multifactorial risk assessment is advised for those identified as being at high risk of falling.</p>
    </article>
    <footer>Copyright 2024 · privacy · terms · cookie notice</footer></body></html>`;
  const text = await htmlToText(html);
  assert.match(text, /structured exercise programmes/);
  assert.match(text, /Multifactorial risk assessment/);
  assert.doesNotMatch(text, /cookie notice/);   // boilerplate dropped
  assert.doesNotMatch(text, /home about contact menu/);
});

test("htmlToText falls back to a tag-strip for non-article markup", async () => {
  const html = "<div>" + "recommendation text about older adults and falls prevention ".repeat(3) + "</div>";
  const text = await htmlToText(html);
  assert.match(text, /falls prevention/);
});
