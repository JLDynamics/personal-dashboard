import assert from "node:assert/strict";
import test from "node:test";

import { mergeTrendingSources } from "../app/data/dashboard-merge.ts";
import { sampleData } from "../app/data/sample-data.ts";

test("X and HN fall back independently without replacing current cards", () => {
  const currentX = structuredClone(sampleData.trends);
  const currentHn = structuredClone(sampleData.hnTrends);
  currentX[0].title = "Keep this saved X story";
  currentHn[0].title = "Keep this saved HN story";

  const freshX = structuredClone(sampleData.trends);
  const freshHn = structuredClone(sampleData.hnTrends);
  freshX[0].title = "Fresh X story";
  freshHn[0].title = "Fresh Hacker News story";

  const hnUpdated = mergeTrendingSources({
    newXItems: freshX,
    liveHnItems: freshHn,
    currentXItems: currentX,
    currentHnItems: currentHn,
    xUnavailable: true,
    hnUnavailable: false,
  });
  assert.equal(hnUpdated.trends[0].title, "Keep this saved X story");
  assert.equal(hnUpdated.hnTrends[0].title, "Fresh Hacker News story");

  const xUpdated = mergeTrendingSources({
    newXItems: freshX,
    liveHnItems: freshHn,
    currentXItems: currentX,
    currentHnItems: currentHn,
    xUnavailable: false,
    hnUnavailable: true,
  });
  assert.equal(xUpdated.trends[0].title, "Fresh X story");
  assert.equal(xUpdated.hnTrends[0].title, "Keep this saved HN story");
});

test("keeps exactly three X and three HN items as separate rankings", () => {
  const result = mergeTrendingSources({
    newXItems: [...sampleData.trends, ...sampleData.trends],
    liveHnItems: [...sampleData.hnTrends, ...sampleData.hnTrends],
    currentXItems: sampleData.trends,
    currentHnItems: sampleData.hnTrends,
    xUnavailable: false,
    hnUnavailable: false,
  });

  assert.equal(result.trends.length, 3);
  assert.equal(result.hnTrends.length, 3);
  assert.ok(result.trends.every((item) => item.source === "X Explore"));
  assert.ok(result.hnTrends.every((item) => item.source === "Hacker News"));
});
