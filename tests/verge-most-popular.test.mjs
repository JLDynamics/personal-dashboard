import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalVergeUrl,
  parseVergeArticleDescription,
  parseVergeMostPopular,
} from "../app/data/verge-most-popular.ts";

const stories = Array.from({ length: 6 }, (_, index) => `
  <li>
    <div>${index + 1}</div>
    <a href="/tech/story-${index + 1}?source=home">Story ${index + 1}</a>
    <time dateTime="2026-07-28T0${index}:00:00">Today</time>
  </li>
`).join("");

const html = `
  <section class="layout duet--homepage--most-popular">
    <h2>Most Popular</h2>
    <ol>${stories}</ol>
  </section>
`;

test("parses exactly five Verge Most Popular stories in published order", () => {
  const parsed = parseVergeMostPopular(html);
  assert.equal(parsed.length, 5);
  assert.deepEqual(
    parsed.map((story) => story.rank),
    [1, 2, 3, 4, 5],
  );
  assert.deepEqual(
    parsed.map((story) => story.url),
    Array.from(
      { length: 5 },
      (_, index) => `https://www.theverge.com/tech/story-${index + 1}`,
    ),
  );
  assert.equal(parsed[0].publishedAt, "2026-07-28T00:00:00.000Z");
});

test("accepts only public HTTPS Verge URLs", () => {
  assert.equal(
    canonicalVergeUrl("https://theverge.com/tech/story/?ref=home#comments"),
    "https://www.theverge.com/tech/story",
  );
  assert.equal(canonicalVergeUrl("http://theverge.com/tech/story"), undefined);
  assert.equal(canonicalVergeUrl("https://example.com/story"), undefined);
});

test("reads a public article description without depending on attribute order", () => {
  assert.equal(
    parseVergeArticleDescription(
      '<meta content="A concise &amp; factual summary." property="og:description">',
    ),
    "A concise & factual summary.",
  );
});
