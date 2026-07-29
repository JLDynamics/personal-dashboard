import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DashboardCache,
  LIBRARY_REFRESH_MS,
  NEWS_REFRESH_MS,
  fingerprint,
} from "../scripts/dashboard-cache.mjs";
import { sampleData } from "../app/data/sample-data.ts";

function liveSnapshot() {
  const snapshot = structuredClone(sampleData);
  snapshot.savedAt = "2026-07-29T12:00:00.000Z";
  snapshot.sourceStatus = {
    x: "Grok 4.5 · live",
    hn: "HN top stories · live",
    tech: "4/4 feeds live",
    market: "Yahoo Finance · live",
    weather: "Open-Meteo · live",
    movies: "YFSP · live",
    calendar: "macOS Calendar · live",
    library: "Agent-note · 1 note",
  };
  snapshot.library = [
    {
      id: "note-1",
      title: "Dashboard cache plan",
      savedAt: "2026-07-29T11:00:00.000Z",
      tags: ["dashboard"],
      summary: "Records the local cache and refresh decisions.",
      content: "# Dashboard cache plan",
    },
  ];
  return snapshot;
}

test("fingerprints are stable across object key order", () => {
  assert.equal(
    fingerprint({ beta: 2, alpha: { zeta: 3, gamma: 1 } }),
    fingerprint({ alpha: { gamma: 1, zeta: 3 }, beta: 2 }),
  );
});

test("SQLite cache keeps one snapshot and per-source refresh state", () => {
  const directory = mkdtempSync(join(tmpdir(), "dashboard-cache-"));
  const cache = new DashboardCache(join(directory, "dashboard.sqlite3"));
  const refreshedAt = new Date("2026-07-29T12:00:00.000Z");

  try {
    const snapshot = liveSnapshot();
    const first = cache.storeRefresh(snapshot, "full", refreshedAt);

    assert.equal(first.snapshot.library[0].summary, snapshot.library[0].summary);
    assert.deepEqual(cache.readSnapshot(), snapshot);
    assert.equal(cache.readSourceStates().length, 11);

    const news = cache.readSourceStates().find((row) => row.source === "x");
    const library = cache
      .readSourceStates()
      .find((row) => row.source === "library");
    assert.equal(
      new Date(news.nextRefreshAt).getTime(),
      refreshedAt.getTime() + NEWS_REFRESH_MS,
    );
    assert.equal(
      new Date(library.nextRefreshAt).getTime(),
      refreshedAt.getTime() + LIBRARY_REFRESH_MS,
    );
    assert.equal(cache.isScopeDue("news", refreshedAt), false);
    assert.equal(
      cache.isScopeDue(
        "news",
        new Date(refreshedAt.getTime() + NEWS_REFRESH_MS),
      ),
      true,
    );

    const unchanged = cache.storeRefresh(snapshot, "full", refreshedAt);
    assert.deepEqual(unchanged.changedSources, []);

    const changed = structuredClone(snapshot);
    changed.savedAt = "2026-07-29T15:00:00.000Z";
    changed.techNews[0].title = "A newly selected MobileSyrup story";
    const result = cache.storeRefresh(
      changed,
      "news",
      new Date(changed.savedAt),
    );

    assert.deepEqual(result.changedSources, ["tech:MobileSyrup"]);
    assert.equal(
      cache.readSnapshot().techNews[0].title,
      "A newly selected MobileSyrup story",
    );
    assert.equal(cache.readSnapshot().library[0].id, "note-1");
  } finally {
    cache.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
