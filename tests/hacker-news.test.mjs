import assert from "node:assert/strict";
import test from "node:test";

import {
  HN_BATCH_SIZE,
  HN_STORY_CAP,
  qualifyHackerNewsStory,
  selectRankedHackerNewsStories,
  toHackerNewsItem,
} from "../app/data/hacker-news.ts";

const NOW = new Date("2026-07-28T18:00:00.000Z");
const NOW_SECONDS = Math.floor(NOW.getTime() / 1_000);

function story(id, title, overrides = {}) {
  return {
    id,
    type: "story",
    time: NOW_SECONDS - 1_800,
    title,
    url: `https://example.com/story-${id}`,
    score: 100 + id,
    descendants: 20 + id,
    ...overrides,
  };
}

test("fetches HN metadata in ranked batches of five and stops at three AI stories", async () => {
  const ids = Array.from({ length: HN_STORY_CAP }, (_, index) => index + 1);
  const stories = new Map([
    [4, story(4, "A new linear attention architecture for AI inference")],
    [7, story(7, "Kimi K3 model architecture overview")],
    [8, story(8, "Anthropic finds cryptographic weaknesses with Claude")],
  ]);
  const fetchedIds = [];

  const selected = await selectRankedHackerNewsStories(async (url) => {
    if (url.endsWith("/topstories.json")) return ids;
    const id = Number(url.match(/\/item\/(\d+)\.json$/)?.[1]);
    fetchedIds.push(id);
    return stories.get(id) ?? story(id, "A regular programming article");
  }, NOW);

  assert.equal(HN_BATCH_SIZE, 5);
  assert.deepEqual(selected.map((item) => item.rank), [4, 7, 8]);
  assert.deepEqual(fetchedIds, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test("filters non-news HN entries, stale items, missing URLs, and jobs", () => {
  const valid = story(1, "OpenAI releases a new inference model");
  assert.ok(qualifyHackerNewsStory(valid, 1, NOW));

  const rejected = [
    story(2, "Ask HN: Which LLM should I use?"),
    story(3, "Show HN: My AI wrapper"),
    story(4, "OpenAI is hiring", { type: "job" }),
    story(5, "Sponsored AI model offer"),
    story(6, "Claude release", { url: undefined }),
    story(7, "Claude release", { dead: true }),
    story(8, "Claude release", { deleted: true }),
    story(9, "Claude release", {
      time: NOW_SECONDS - 8 * 24 * 60 * 60,
    }),
    story(10, "A database indexing article"),
  ];

  rejected.forEach((candidate, index) => {
    assert.equal(
      qualifyHackerNewsStory(candidate, index + 2, NOW),
      undefined,
    );
  });
});

test("deduplicates repeated HN articles while preserving original rank", async () => {
  const ids = [1, 2, 3, 4, 5];
  const duplicateUrl = "https://example.com/ai-release?utm_source=hn";
  const stories = new Map([
    [1, story(1, "OpenAI releases a new reasoning model", { url: duplicateUrl })],
    [2, story(2, "OpenAI releases a new reasoning model today", {
      url: "https://example.com/ai-release",
    })],
    [3, story(3, "Claude adds agentic tool use")],
    [4, story(4, "Kimi K3 model architecture overview")],
  ]);

  const selected = await selectRankedHackerNewsStories(async (url) => {
    if (url.endsWith("/topstories.json")) return ids;
    const id = Number(url.match(/\/item\/(\d+)\.json$/)?.[1]);
    return stories.get(id) ?? story(id, "A non AI programming article");
  }, NOW);

  assert.deepEqual(selected.map((item) => item.rank), [1, 3, 4]);
});

test("creates an HN card with direct article and discussion provenance", () => {
  const selected = qualifyHackerNewsStory(
    story(42, "Anthropic releases a Claude inference update"),
    6,
    NOW,
  );
  assert.ok(selected);
  const item = toHackerNewsItem(selected, undefined, NOW);

  assert.equal(item.source, "Hacker News");
  assert.equal(item.hnRank, 6);
  assert.equal(item.destinationUrl, "https://example.com/story-42");
  assert.equal(
    item.discussionUrl,
    "https://news.ycombinator.com/item?id=42",
  );
  assert.match(item.summary, /Ranked #6/);
  assert.match(item.signal, /points/);
});
