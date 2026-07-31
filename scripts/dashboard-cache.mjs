import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const NEWS_REFRESH_MS = 3 * 60 * 60 * 1_000;
export const LIVE_SOURCE_REFRESH_MS = NEWS_REFRESH_MS;
export const LIBRARY_REFRESH_MS = 12 * 60 * 60 * 1_000;
export const DEFAULT_DATABASE_PATH = resolve(
  process.cwd(),
  ".local",
  "dashboard.sqlite3",
);

const NEWS_SOURCES = [
  "x",
  "hn",
  "tech:MobileSyrup",
  "tech:Wccftech",
  "tech:iPhone in Canada",
  "tech:The Verge",
];
const LIBRARY_SOURCES = ["library"];
const LIVE_CARD_SOURCES = ["market", "weather", "calendar", "movies"];
const SCHEDULED_SOURCES = [
  ...NEWS_SOURCES,
  ...LIVE_CARD_SOURCES,
  ...LIBRARY_SOURCES,
];

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableJson(child)]),
  );
}

export function fingerprint(value) {
  return createHash("sha256")
    .update(JSON.stringify(stableJson(value)))
    .digest("hex");
}

function sourcePayloads(snapshot) {
  return {
    x: snapshot.trends,
    hn: snapshot.hnTrends,
    "tech:MobileSyrup": snapshot.techNews.filter(
      (item) => item.source === "MobileSyrup",
    ),
    "tech:Wccftech": snapshot.techNews.filter(
      (item) => item.source === "Wccftech",
    ),
    "tech:iPhone in Canada": snapshot.techNews.filter(
      (item) => item.source === "iPhone in Canada",
    ),
    "tech:The Verge": snapshot.techNews.filter(
      (item) => item.source === "The Verge",
    ),
    market: snapshot.tesla,
    weather: snapshot.weather,
    calendar: snapshot.schedule,
    movies: snapshot.movies,
    library: snapshot.library,
  };
}

function sourceNamesForScope(scope) {
  if (scope === "news") return NEWS_SOURCES;
  if (LIVE_CARD_SOURCES.includes(scope)) return [scope];
  if (scope === "library") return LIBRARY_SOURCES;
  return SCHEDULED_SOURCES;
}

function sourceAvailable(snapshot, source) {
  if (source === "x") return snapshot.sourceStatus.x !== "Saved Trending AI";
  if (source === "hn") return snapshot.sourceStatus.hn !== "Saved Hacker News";
  if (source.startsWith("tech:")) {
    return (
      snapshot.sourceStatus.tech !== "Saved feeds" &&
      !snapshot.sourceStatus.tech.startsWith("0/")
    );
  }
  if (source === "market") return snapshot.sourceStatus.market !== "Saved quote";
  if (source === "weather") {
    return snapshot.sourceStatus.weather !== "Saved forecast";
  }
  if (source === "calendar") {
    return snapshot.sourceStatus.calendar !== "Saved schedule";
  }
  if (source === "movies") {
    return snapshot.sourceStatus.movies !== "Saved Recently Added";
  }
  if (source === "library") {
    return snapshot.sourceStatus.library !== "Notes folder unavailable";
  }
  return false;
}

function nextRefreshAt(source, refreshedAt) {
  const interval =
    source === "library" ? LIBRARY_REFRESH_MS : LIVE_SOURCE_REFRESH_MS;
  if (!SCHEDULED_SOURCES.includes(source)) {
    return "";
  }
  return new Date(new Date(refreshedAt).getTime() + interval).toISOString();
}

function mergeScope(current, incoming, scope, changedSources) {
  if (!current) return incoming;
  const next = {
    ...current,
    profile: incoming.profile,
    sourceStatus: { ...current.sourceStatus },
  };

  if (scope === "full") {
    if (changedSources.has("x")) {
      next.trends = incoming.trends;
      next.sourceStatus.x = incoming.sourceStatus.x;
    }
    if (changedSources.has("hn")) {
      next.hnTrends = incoming.hnTrends;
      next.sourceStatus.hn = incoming.sourceStatus.hn;
    }
    if ([...changedSources].some((source) => source.startsWith("tech:"))) {
      next.techNews = incoming.techNews;
      next.sourceStatus.tech = incoming.sourceStatus.tech;
    }
    if (changedSources.has("market")) {
      next.tesla = incoming.tesla;
      next.sourceStatus.market = incoming.sourceStatus.market;
    }
    if (changedSources.has("weather")) {
      next.weather = incoming.weather;
      next.sourceStatus.weather = incoming.sourceStatus.weather;
    }
    if (changedSources.has("calendar")) {
      next.schedule = incoming.schedule;
      next.sourceStatus.calendar = incoming.sourceStatus.calendar;
    }
    if (changedSources.has("movies")) {
      next.movies = incoming.movies;
      next.sourceStatus.movies = incoming.sourceStatus.movies;
    }
    if (changedSources.has("library")) {
      next.library = incoming.library;
      next.sourceStatus.library = incoming.sourceStatus.library;
    }
  } else if (scope === "news") {
    if (changedSources.has("x")) {
      next.trends = incoming.trends;
      next.sourceStatus.x = incoming.sourceStatus.x;
    }
    if (changedSources.has("hn")) {
      next.hnTrends = incoming.hnTrends;
      next.sourceStatus.hn = incoming.sourceStatus.hn;
    }
    if ([...changedSources].some((source) => source.startsWith("tech:"))) {
      next.techNews = incoming.techNews;
      next.sourceStatus.tech = incoming.sourceStatus.tech;
    }
  } else if (changedSources.has(scope)) {
    if (scope === "market") {
      next.tesla = incoming.tesla;
      next.sourceStatus.market = incoming.sourceStatus.market;
    } else if (scope === "weather") {
      next.weather = incoming.weather;
      next.sourceStatus.weather = incoming.sourceStatus.weather;
    } else if (scope === "calendar") {
      next.schedule = incoming.schedule;
      next.sourceStatus.calendar = incoming.sourceStatus.calendar;
    } else if (scope === "movies") {
      next.movies = incoming.movies;
      next.sourceStatus.movies = incoming.sourceStatus.movies;
    } else if (scope === "library") {
      next.library = incoming.library;
      next.sourceStatus.library = incoming.sourceStatus.library;
    }
  }

  if (changedSources.size) next.savedAt = incoming.savedAt;
  return next;
}

export class DashboardCache {
  constructor(databasePath = DEFAULT_DATABASE_PATH) {
    this.databasePath = resolve(databasePath);
    mkdirSync(dirname(this.databasePath), { recursive: true });
    this.database = new DatabaseSync(this.databasePath);
    this.database.exec(`
      PRAGMA journal_mode = DELETE;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS dashboard_snapshot (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        saved_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS source_state (
        source TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL,
        refreshed_at TEXT NOT NULL,
        next_refresh_at TEXT NOT NULL,
        changed INTEGER NOT NULL CHECK (changed IN (0, 1))
      );
    `);
  }

  close() {
    this.database.close();
  }

  readSnapshot() {
    const row = this.database
      .prepare("SELECT payload FROM dashboard_snapshot WHERE id = 1")
      .get();
    if (!row) return undefined;
    try {
      return JSON.parse(row.payload);
    } catch {
      return undefined;
    }
  }

  readSourceStates() {
    return this.database
      .prepare(
        `SELECT source, fingerprint, refreshed_at AS refreshedAt,
                next_refresh_at AS nextRefreshAt, changed
         FROM source_state
         ORDER BY source`,
      )
      .all()
      .map((row) => ({ ...row, changed: row.changed === 1 }));
  }

  isScopeDue(scope, now = new Date()) {
    const sources = sourceNamesForScope(scope);
    const rows = new Map(
      this.readSourceStates().map((row) => [row.source, row]),
    );
    return sources.some((source) => {
      const row = rows.get(source);
      if (!row || !row.nextRefreshAt) return true;
      return new Date(row.nextRefreshAt).getTime() <= now.getTime();
    });
  }

  storeRefresh(incoming, scope = "full", refreshedAt = new Date()) {
    const timestamp = refreshedAt.toISOString();
    const current = this.readSnapshot();
    const payloads = sourcePayloads(incoming);
    const previousStates = new Map(
      this.readSourceStates().map((row) => [row.source, row]),
    );
    const changedSources = new Set();
    const stateRows = [];

    for (const source of sourceNamesForScope(scope)) {
      if (!sourceAvailable(incoming, source)) continue;
      const nextFingerprint = fingerprint(payloads[source]);
      const previous = previousStates.get(source);
      const changed = previous?.fingerprint !== nextFingerprint;
      if (changed || !current) changedSources.add(source);
      stateRows.push({
        source,
        fingerprint: nextFingerprint,
        refreshedAt: timestamp,
        nextRefreshAt: nextRefreshAt(source, timestamp),
        changed,
      });
    }

    const snapshot = mergeScope(current, incoming, scope, changedSources);
    const writeSnapshot = this.database.prepare(`
      INSERT INTO dashboard_snapshot (id, saved_at, payload)
      VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        saved_at = excluded.saved_at,
        payload = excluded.payload
    `);
    const writeState = this.database.prepare(`
      INSERT INTO source_state
        (source, fingerprint, refreshed_at, next_refresh_at, changed)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(source) DO UPDATE SET
        fingerprint = excluded.fingerprint,
        refreshed_at = excluded.refreshed_at,
        next_refresh_at = excluded.next_refresh_at,
        changed = excluded.changed
    `);

    this.database.exec("BEGIN IMMEDIATE");
    try {
      writeSnapshot.run(snapshot.savedAt, JSON.stringify(snapshot));
      for (const row of stateRows) {
        writeState.run(
          row.source,
          row.fingerprint,
          row.refreshedAt,
          row.nextRefreshAt,
          row.changed ? 1 : 0,
        );
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }

    return {
      snapshot,
      changedSources: [...changedSources].sort(),
      refreshedSources: stateRows.map((row) => row.source).sort(),
    };
  }
}
