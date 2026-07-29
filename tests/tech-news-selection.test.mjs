import assert from "node:assert/strict";
import test from "node:test";

import {
  categorizeTechArticle,
  selectDiverseTechNews,
  updateTechPreferenceProfile,
} from "../app/data/tech-news-selection.ts";

const NOW = new Date("2026-07-28T18:00:00.000Z");

function article(source, id, title, hoursAgo = 1, overrides = {}) {
  return {
    id: `tech-${id}`,
    title,
    summary: `A factual technology description for ${title}.`,
    source,
    age: `${hoursAgo}h`,
    publishedAt: new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString(),
    contentHash: `hash-${id}`,
    destinationUrl: `https://example.com/${source.toLowerCase().replaceAll(" ", "-")}/${id}`,
    ...overrides,
  };
}

const candidates = [
  article("MobileSyrup", "ms-phone", "Pixel camera adds satellite messaging", 1),
  article("MobileSyrup", "ms-canada", "Canadian fibre rules reshape telecom market", 2),
  article("MobileSyrup", "ms-security", "Privacy update blocks tracking scripts", 3),
  article("MobileSyrup", "ms-chip", "New laptop processor improves battery life", 4),
  article("MobileSyrup", "ms-platform", "Cloud platform changes app subscriptions", 5),
  article("Wccftech", "w-phone", "Galaxy fold design improves its hinge", 1),
  article("Wccftech", "w-chip", "NVIDIA GPU architecture improves efficiency", 2),
  article("Wccftech", "w-security", "Browser security patch closes an exploit", 3),
  article("Wccftech", "w-game", "New console game engine reduces loading", 4),
  article("Wccftech", "w-ai", "AI inference system reduces memory use", 5),
  article("iPhone in Canada", "ic-phone", "AirPods hearing feature arrives in Canada", 1),
  article("iPhone in Canada", "ic-canada", "CRTC changes wireless competition rules", 2),
  article("iPhone in Canada", "ic-chip", "MacBook chip increases graphics performance", 3),
  article("iPhone in Canada", "ic-security", "Apple account security gains passkeys", 4),
  article("iPhone in Canada", "ic-platform", "App Store platform changes subscriptions", 5),
  article("The Verge", "v-1", "Verge popular phone story", 5),
  article("The Verge", "v-2", "Verge popular AI story", 4),
  article("The Verge", "v-3", "Verge popular gaming story", 3),
  article("The Verge", "v-4", "Verge popular security story", 2),
  article("The Verge", "v-5", "Verge popular platform story", 1),
];

test("builds a fourteen-story mix across four sources", () => {
  const selected = selectDiverseTechNews(
    candidates,
    { topicWeights: {}, recentUrls: [] },
    NOW,
  );

  assert.equal(selected.length, 14);
  for (const source of ["MobileSyrup", "Wccftech", "iPhone in Canada"]) {
    assert.equal(selected.filter((item) => item.source === source).length, 3);
  }
  assert.equal(selected.filter((item) => item.source === "The Verge").length, 5);

  const topicCounts = new Map();
  selected
    .filter(
      (item) =>
        item.source === "MobileSyrup" || item.source === "iPhone in Canada",
    )
    .forEach((item) => {
    const topic = categorizeTechArticle(item);
    topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
    });
  assert.ok([...topicCounts.values()].every((count) => count <= 2));
});

test("removes sponsored, stale, and duplicate candidates", () => {
  const sponsored = article(
    "MobileSyrup",
    "sponsored",
    "Sponsored deal saves shoppers fifty percent",
  );
  const stale = article("Wccftech", "stale", "A useful new computer", 24 * 8);
  const duplicate = article(
    "iPhone in Canada",
    "duplicate",
    "Another title for the same article",
    1,
    { destinationUrl: candidates[0].destinationUrl },
  );

  const selected = selectDiverseTechNews(
    [...candidates, sponsored, stale, duplicate],
    { topicWeights: {}, recentUrls: [] },
    NOW,
  );
  const ids = new Set(selected.map((item) => item.id));

  assert.equal(ids.has(sponsored.id), false);
  assert.equal(ids.has(stale.id), false);
  assert.equal(ids.has(duplicate.id), false);
  assert.equal(new Set(selected.map((item) => item.destinationUrl)).size, selected.length);
});

test("gently boosts clicked topics without removing diversity", () => {
  const pool = [
    article("MobileSyrup", "wildcard-new", "Unexpected robotics laboratory result", 1),
    article("MobileSyrup", "phone-older", "New iPhone camera and battery design", 24),
    article("MobileSyrup", "security-older", "Security patch fixes account access", 22),
    article("MobileSyrup", "chip-older", "Laptop chip improves graphics speed", 20),
  ];

  const ordinary = selectDiverseTechNews(
    pool,
    { topicWeights: {}, recentUrls: [] },
    NOW,
  );
  const personalized = selectDiverseTechNews(
    pool,
    { topicWeights: { "phones-gadgets": 6 }, recentUrls: [] },
    NOW,
  );

  assert.equal(ordinary[0].id, "tech-wildcard-new");
  assert.equal(personalized[0].id, "tech-phone-older");
  assert.ok(new Set(personalized.map(categorizeTechArticle)).size >= 3);
});

test("records a click locally as a decaying topic preference", () => {
  const clicked = candidates[0];
  const updated = updateTechPreferenceProfile(
    {
      topicWeights: { "phones-gadgets": 2, "security-privacy": 2 },
      recentUrls: ["https://example.com/previous"],
    },
    clicked,
  );

  assert.equal(updated.topicWeights["phones-gadgets"], 2.84);
  assert.equal(updated.topicWeights["security-privacy"], 1.84);
  assert.equal(updated.recentUrls[0], clicked.destinationUrl);
});

test("keeps Wccftech stories in the supplied trending order", () => {
  const wccftechTrending = [
    article("Wccftech", "trend-1", "Trending gaming story", 72),
    article("Wccftech", "trend-2", "Trending AI model story", 1),
    article("Wccftech", "trend-3", "Trending security story", 48),
  ];
  const selected = selectDiverseTechNews(
    [
      ...candidates.filter((item) => item.source !== "Wccftech"),
      ...wccftechTrending,
    ],
    { topicWeights: { "ai-tech": 8 }, recentUrls: [] },
    NOW,
  );

  assert.deepEqual(
    selected
      .filter((item) => item.source === "Wccftech")
      .map((item) => item.id),
    wccftechTrending.map((item) => item.id),
  );
});

test("keeps all five Verge stories in the supplied Most Popular order", () => {
  const vergePopular = candidates.filter((item) => item.source === "The Verge");
  const selected = selectDiverseTechNews(
    candidates,
    { topicWeights: { "phones-gadgets": 8 }, recentUrls: [] },
    NOW,
  );

  assert.deepEqual(
    selected
      .filter((item) => item.source === "The Verge")
      .map((item) => item.id),
    vergePopular.map((item) => item.id),
  );
});
