import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const templateRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the complete personal dashboard", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Local Daily Dashboard<\/title>/i);
  assert.match(html, /Trending AI now/);
  assert.doesNotMatch(html, /X Today’s News/);
  assert.doesNotMatch(html, /Hacker News top stories/);
  assert.doesNotMatch(html, /Two independent rankings · 6 stories/);
  assert.doesNotMatch(html, /Builder brief|New methods/);
  assert.match(html, /Tech news/);
  assert.match(html, /My Library/);
  assert.match(html, /Past 7 Days/);
  assert.match(html, /Library unavailable/);
  assert.doesNotMatch(html, /Ask My Dashboard/);
  assert.match(html, /Tesla/);
  assert.match(html, /Schedule/);
  assert.match(html, /No upcoming events in the next 7 days/);
  assert.match(html, /Sample location/);
  assert.match(html, /New movies/);
  assert.match(html, /Refresh now/);
  assert.match(html, /x\.com\/i\/trending\/2080729042374820132/);
  assert.match(html, /x\.com\/i\/trending\/2080650739823890443/);
  assert.match(html, /x\.com\/i\/trending\/2080363005372772749/);
  assert.match(
    html,
    /large policy discussion is forming around keeping downloadable AI model weights/i,
  );
  assert.match(
    html,
    /flash variants aimed at efficient agent workloads and practical deployment/i,
  );
  assert.doesNotMatch(html, /x\.com\/explore/);
  assert.match(html, /A walk through of the DeltaNet family/);
  assert.match(html, /Kimi K3 Architecture Overview and Notes/);
  assert.match(html, /Discovering Cryptographic Weaknesses with Claude/);
  for (let order = 1; order <= 6; order += 1) {
    assert.match(html, new RegExp(`data-order="${order}"`));
  }
  assert.equal((html.match(/class="article-order"/g) ?? []).length, 6);
  assert.doesNotMatch(html, /Read the conversation/);
  assert.doesNotMatch(html, />Discussion(?:\s|<)/);
  assert.match(
    html,
    /blog\.doubleword\.ai\/you-could-have-come-up-with-kimi-delta-attention/,
  );
  assert.match(html, /sebastianraschka\.com\/blog\/2026\/kimi-k3/);
  assert.match(html, /anthropic\.com\/research\/discovering-cryptographic/);
  assert.doesNotMatch(html, /news\.ycombinator\.com\/item\?id=/);
  assert.doesNotMatch(html, /github\.com\/topics\//);
  assert.match(html, /mobilesyrup\.com\/2026\/07\/24\/streaming-in-canada/);
  assert.match(html, /wccftech\.com\/god-of-war-laufey-february-2027/);
  assert.match(html, /iphoneincanada\.ca\/2026\/07\/24\/teksavvy/);
  assert.doesNotMatch(
    html,
    /href="https:\/\/(?:mobilesyrup\.com|wccftech\.com|www\.iphoneincanada\.ca)\/"/,
  );
  assert.match(html, /Leviticus/);
  assert.match(html, /Blazing Sands/);
  assert.match(html, /Supergirl/);
  assert.match(html, /Romance · Science fiction · Horror/);
  assert.match(html, /Drama · Action · Crime/);
  assert.match(html, /Action · Science fiction · Fantasy/);
  assert.doesNotMatch(html, /[\u3400-\u9fff\uf900-\ufaff]/u);
  assert.equal((html.match(/Recently added/g) ?? []).length >= 3, true);
  assert.match(
    html,
    /src="https:\/\/static\.yfsp\.tv\/upload\/video\/202607281314041478848\.gif/,
  );
  assert.doesNotMatch(html, /href="https:\/\/(?:www\.)?yfsp\.tv\/play\//);
  assert.doesNotMatch(
    html,
    /Disclosure Day|The Mandalorian and Grogu|The Devil Wears Prada 2/,
  );
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/);
});

test("removes starter-only files and keeps the live-source boundary", async () => {
  const [page, layout, dashboard, packageJson, adapters, liveAdapters, hackerNews, route, refreshPolicy, viteConfig, collector, calendarCollector, localNotesLibrary, daemon] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/data/adapters.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/data/live-adapters.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/data/hacker-news.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/dashboard/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/data/refresh-policy.ts", import.meta.url), "utf8"),
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/grok-x-collector.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/calendar-collector.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/local-notes-library.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/dashboard-daemon.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<Dashboard \/>/);
  assert.match(layout, /Local Daily Dashboard/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(adapters, /xExplore/);
  assert.match(adapters, /movies/);
  assert.match(liveAdapters, /mobilesyrup\.com\/feed/);
  assert.match(liveAdapters, /wccftech\.com\/feed/);
  assert.match(liveAdapters, /iphoneincanada\.ca\/feed/);
  assert.match(liveAdapters, /theverge\.com\/rss\/index\.xml/);
  assert.match(liveAdapters, /VERGE_HOME_URL/);
  assert.match(liveAdapters, /api\.open-meteo\.com/);
  assert.match(liveAdapters, /finance\.yahoo\.com/);
  assert.match(liveAdapters, /GROK_X_COLLECTOR_URL/);
  assert.match(liveAdapters, /GROK_X_COLLECTOR_TOKEN/);
  assert.match(
    hackerNews,
    /hacker-news\.firebaseio\.com\/v0\/topstories\.json/,
  );
  assert.match(hackerNews, /HN_BATCH_SIZE = 5/);
  assert.match(hackerNews, /HN_STORY_CAP = 30/);
  assert.match(liveAdapters, /fetchHackerNews/);
  assert.match(liveAdapters, /summarize-hn/);
  assert.match(collector, /HN_SUMMARY_PROMPT/);
  assert.match(collector, /--disable-web-search/);
  assert.doesNotMatch(liveAdapters, /xSnapshot/);
  assert.match(viteConfig, /GROK_X_COLLECTOR_URL/);
  assert.match(viteConfig, /GROK_X_COLLECTOR_TOKEN/);
  assert.match(viteConfig, /DASHBOARD_WEATHER_LATITUDE/);
  assert.match(viteConfig, /DASHBOARD_DISPLAY_NAME/);
  assert.match(viteConfig, /vars: localCollectorVars/);
  assert.match(liveAdapters, /YFSP_MOVIE_FEED_URL/);
  assert.match(liveAdapters, /MACOS_CALENDAR_FEED_URL/);
  assert.match(liveAdapters, /DASHBOARD_NOTES_LIBRARY_FEED_URL/);
  assert.match(viteConfig, /DASHBOARD_NOTES_LIBRARY_FEED_URL/);
  assert.match(collector, /local-notes-library/);
  assert.match(daemon, /SCHEDULED_SCOPES/);
  assert.match(daemon, /"news",\s*"market",\s*"weather",\s*"calendar",\s*"movies",\s*"library"/);
  assert.match(daemon, /Promise\.allSettled/);
  assert.match(localNotesLibrary, /DASHBOARD_NOTES_FOLDER/);
  assert.match(localNotesLibrary, /realpath/);
  assert.match(localNotesLibrary, /entry\.isSymbolicLink\(\)/);
  assert.match(localNotesLibrary, /legacySummaryFromNoteText/);
  assert.doesNotMatch(localNotesLibrary, /execFile|child_process|AGENT_NOTE/);
  assert.match(dashboard, /\{note\.summary\}/);
  assert.doesNotMatch(dashboard, /\{note\.preview\}/);
  assert.equal(
    dashboard.indexOf('className="card tech-card"') <
      dashboard.indexOf('className="card library-card"'),
    true,
  );
  assert.equal(
    dashboard.indexOf('className="card library-card"') <
      dashboard.indexOf("dashboard-column-side"),
    true,
  );
  assert.match(calendarCollector, /EventKit/);
  assert.match(calendarCollector, /CALENDAR_EVENT_LIMIT = 8/);
  assert.match(route, /getLiveDashboard/);
  assert.match(refreshPolicy, /seenFingerprints/);
  assert.match(refreshPolicy, /ENGAGEMENT_BAIT/);
  assert.match(refreshPolicy, /candidatesForOptionalAiReview/);
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", templateRoot)));
});

test("processes unchanged AI candidates only once", async () => {
  const { filterNewAiCandidates } = await import(
    "../app/data/refresh-policy.ts"
  );
  const candidate = {
    id: "stable-story-id",
    title: "Agent SDK release adds a working repository and API",
    summary: "The release includes code, benchmarks, and a working demo.",
    source: "X Explore",
    age: "1h",
    publishedAt: "2026-07-24T18:00:00.000Z",
    contentHash: "stable-content-hash",
    destinationUrl: "https://x.com/example/status/123",
    signal: "High signal",
  };

  const first = filterNewAiCandidates(
    [candidate, candidate],
    new Set(),
    new Date("2026-07-25T00:00:00.000Z"),
  );
  assert.equal(first.candidateCount, 1);
  assert.equal(first.accepted.length, 1);

  const second = filterNewAiCandidates(
    [candidate],
    new Set(first.observedFingerprints),
    new Date("2026-07-25T00:05:00.000Z"),
  );
  assert.equal(second.accepted.length, 0);
  assert.equal(second.skippedSeen, 1);
});

test("uses source-added order only after validating original release dates", async () => {
  const { selectNewReleaseMovies } = await import(
    "../app/data/movie-selection.ts"
  );
  const base = {
    id: "movie-newer-source",
    sourceId: "yfsp:newer-source",
    title: "Current Release",
    year: "2026",
    genre: "Drama",
    description: "A genuinely new movie.",
    sourceAddedAt: "2026-07-24T18:00:00.000Z",
    originalReleaseDate: "2026-06-12",
    releaseLabel: "Released Jun 12",
    sourceEdition: "original-release",
    posterUrl: "/poster.jpg",
    posterAlt: "Current Release poster",
    posterClass: "poster-blue",
    monogram: "CR",
  };
  const candidates = [
    {
      ...base,
      id: "movie-older-source",
      sourceId: "yfsp:older-source",
      title: "Earlier Source Addition",
      sourceAddedAt: "2026-07-23T18:00:00.000Z",
      originalReleaseDate: "2026-07-01",
    },
    base,
    {
      ...base,
      id: "movie-old-hd",
      sourceId: "yfsp:old-hd",
      title: "Old Film in HD",
      year: "1998",
      sourceAddedAt: "2026-07-25T00:00:00.000Z",
      originalReleaseDate: "1998-05-01",
      sourceEdition: "hd-upgrade",
    },
  ];

  const selected = selectNewReleaseMovies(
    candidates,
    new Date("2026-07-25T00:00:00.000Z"),
  );

  assert.deepEqual(
    selected.map((movie) => movie.id),
    ["movie-newer-source", "movie-older-source"],
  );
});
