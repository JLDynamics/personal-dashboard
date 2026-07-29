import type {
  DashboardData,
  HackerNewsItem,
  Movie,
  NewsItem,
} from "./types";

export type AdapterResult<T> = {
  items: T[];
  fetchedAt: string;
  sourceAvailable: boolean;
};

export interface DashboardAdapters {
  xExplore: () => Promise<AdapterResult<NewsItem>>;
  hackerNews: () => Promise<AdapterResult<HackerNewsItem>>;
  techNews: () => Promise<AdapterResult<NewsItem>>;
  movies: () => Promise<AdapterResult<Movie>>;
  market: () => Promise<AdapterResult<DashboardData["tesla"]>>;
  weather: () => Promise<AdapterResult<DashboardData["weather"]>>;
}

/*
 * Live adapter boundary:
 * - Trending AI comes from a localhost-only Grok 4.5 collector. The collector
 *   uses Grok's supported X search and never reads browser cookies or private
 *   X endpoints. It returns stable source IDs, timestamps, content hashes, and
 *   direct public X destinations.
 * - Local rules remove duplicates, seen items, stale content, non-AI topics,
 *   engagement bait, and candidates without concrete evidence.
 * - Grok is used only for the X search collection step. Validation, filtering,
 *   deduplication, merging, and caching remain deterministic local logic.
 * - Hacker News selection uses official topstories order and local rules.
 *   The server extracts each selected article's readable body, then Grok
 *   receives those three article texts for one no-search summary call.
 * - RSS/HTML, market, weather, deduplication, and caching remain local logic.
 * - The YFSP "Recently Added" list is only the daily discovery queue. Its
 *   added date is stored separately and is never treated as a release date.
 * - Movie candidates are matched to reliable metadata for an original public
 *   theatrical/streaming date. Old re-releases, restorations, and HD upgrades
 *   are rejected even when YFSP has just added them.
 * - Accepted movies retain YFSP's added-time order, deduplicate by stable
 *   source/metadata identity, and never expose a source link in the UI.
 */
