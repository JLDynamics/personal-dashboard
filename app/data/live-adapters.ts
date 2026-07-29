import {
  selectRankedHackerNewsStories,
  toHackerNewsItem,
} from "./hacker-news";
import { sampleData } from "./sample-data";
import {
  canonicalWccftechUrl,
  parseWccftechTrendingStories,
} from "./wccftech-trending";
import {
  canonicalVergeUrl,
  parseVergeArticleDescription,
  parseVergeMostPopular,
} from "./verge-most-popular";
import {
  extractReadableArticleText,
  publicArticleUrl,
} from "./article-content";
import type {
  CalendarEvent,
  DashboardData,
  HackerNewsItem,
  HourForecast,
  LibraryNote,
  Movie,
  NewsItem,
  SourceName,
} from "./types";

const USER_AGENT = "LocalDailyDashboard/0.1 (local-first dashboard)";
const REQUEST_TIMEOUT_MS = 9_000;
const GROK_COLLECTOR_TIMEOUT_MS = 45_000;

type FeedEntry = {
  id: string;
  title: string;
  url: string;
  publishedAt: string;
  description: string;
};

type AdapterResult<T> = {
  value: T;
  status: string;
};

const TECH_FEEDS: Array<{ source: SourceName; url: string }> = [
  { source: "MobileSyrup", url: "https://mobilesyrup.com/feed/" },
  { source: "Wccftech", url: "https://wccftech.com/feed/" },
  { source: "iPhone in Canada", url: "https://www.iphoneincanada.ca/feed/" },
  { source: "The Verge", url: "https://www.theverge.com/rss/index.xml" },
];
const TECH_CANDIDATES_PER_SOURCE = 10;
const WCCFTECH_HOME_URL = "https://wccftech.com/";
const VERGE_HOME_URL = "https://www.theverge.com/";

function getLocalBridgeUrl(name: string): string | undefined {
  const value = getEnvironmentValue(name);
  if (!value) return undefined;

  try {
    const url = new URL(value);
    if (url.protocol !== "http:") return undefined;
    if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function getEnvironmentValue(name: string): string | undefined {
  if (typeof process !== "undefined") {
    return process.env[name]?.trim() || undefined;
  }
  return undefined;
}

function configuredNumber(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const candidate = Number(getEnvironmentValue(name));
  return Number.isFinite(candidate) &&
    candidate >= minimum &&
    candidate <= maximum
    ? candidate
    : fallback;
}

function dashboardProfile(): DashboardData["profile"] {
  return {
    displayName: (getEnvironmentValue("DASHBOARD_DISPLAY_NAME") ?? "").slice(
      0,
      80,
    ),
  };
}

function weatherSettings() {
  return {
    latitude: configuredNumber(
      "DASHBOARD_WEATHER_LATITUDE",
      0,
      -90,
      90,
    ),
    longitude: configuredNumber(
      "DASHBOARD_WEATHER_LONGITUDE",
      0,
      -180,
      180,
    ),
    location:
      getEnvironmentValue("DASHBOARD_WEATHER_LOCATION") ??
      "Sample location",
    timeZone:
      getEnvironmentValue("DASHBOARD_TIME_ZONE") ?? "UTC",
  };
}

async function fetchWithTimeout(
  url: string,
  timeoutMs = REQUEST_TIMEOUT_MS,
  headers: Record<string, string> = {},
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      headers: {
        accept:
          "application/json, application/rss+xml, application/atom+xml, text/xml, */*",
        "user-agent": USER_AGENT,
        ...(init.headers ?? {}),
        ...headers,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Source returned ${response.status}`);
    }
    return response;
  } finally {
    clearTimeout(timer);
  }
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#039;/g, "'")
    .replace(/&amp;/g, "&");
}

function plainText(value: string): string {
  return decodeXml(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tagValue(block: string, tag: string): string {
  const match = block.match(
    new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"),
  );
  return match ? decodeXml(match[1]).trim() : "";
}

function stableHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function concise(value: string, maxLength = 176): string {
  const text = plainText(value)
    .replace(/\s*(?:Read full article|The post)\b[\s\S]*$/i, "")
    .trim();
  if (text.length <= maxLength) return text;

  const shortened = text.slice(0, maxLength + 1);
  const sentence = shortened.match(/^(.{70,176}?[.!?])(?:\s|$)/);
  if (sentence) return sentence[1];
  return `${shortened.slice(0, shortened.lastIndexOf(" "))}…`;
}

function ageLabel(value: string, now = new Date()): string {
  const milliseconds = now.getTime() - new Date(value).getTime();
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "Now";
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function parseRss(xml: string): FeedEntry[] {
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map(
    ([, block]) => {
      const title = plainText(tagValue(block, "title"));
      const url = plainText(tagValue(block, "link"));
      const publishedAt = tagValue(block, "pubDate");
      const description = tagValue(block, "description");
      const guid = plainText(tagValue(block, "guid"));
      return {
        id: guid || url,
        title,
        url,
        publishedAt: new Date(publishedAt).toISOString(),
        description,
      };
    },
  );
}

function attributeValue(block: string, tag: string, attribute: string): string {
  const openingTag = block.match(new RegExp(`<${tag}\\b[^>]*>`, "i"))?.[0];
  const match = openingTag?.match(
    new RegExp(`\\b${attribute}=["']([^"']+)["']`, "i"),
  );
  return match ? decodeXml(match[1]).trim() : "";
}

function parseAtom(xml: string): FeedEntry[] {
  return [...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)].map(
    ([, block]) => {
      const title = plainText(tagValue(block, "title"));
      const url = attributeValue(block, "link", "href");
      const publishedAt = tagValue(block, "published") || tagValue(block, "updated");
      const description = tagValue(block, "summary");
      const id = plainText(tagValue(block, "id"));
      return {
        id: id || url,
        title,
        url,
        publishedAt: new Date(publishedAt).toISOString(),
        description,
      };
    },
  );
}

function validDirectXUrl(value: string): boolean {
  return /^https:\/\/x\.com\/(?:i\/trending\/\d+|[^/]+\/status\/\d+)(?:[/?#].*)?$/i.test(
    value,
  );
}

function isNewsItem(value: unknown): value is NewsItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<NewsItem>;
  return (
    typeof item.id === "string" &&
    typeof item.title === "string" &&
    typeof item.summary === "string" &&
    item.source === "X Explore" &&
    typeof item.publishedAt === "string" &&
    typeof item.contentHash === "string" &&
    typeof item.destinationUrl === "string" &&
    validDirectXUrl(item.destinationUrl)
  );
}

async function fetchXExplore(): Promise<AdapterResult<NewsItem[]>> {
  const collectorUrl = getLocalBridgeUrl("GROK_X_COLLECTOR_URL");
  const collectorToken = getEnvironmentValue("GROK_X_COLLECTOR_TOKEN");

  if (collectorUrl && collectorToken) {
    try {
      const payload = (await (
        await fetchWithTimeout(
          collectorUrl,
          GROK_COLLECTOR_TIMEOUT_MS,
          { authorization: `Bearer ${collectorToken}` },
        )
      ).json()) as
        | NewsItem[]
        | { items?: unknown[] };
      const items = Array.isArray(payload)
        ? payload.filter(isNewsItem)
        : (payload.items ?? []).filter(isNewsItem);
      if (items.length === 3) {
        return { value: items, status: "Live Grok 4.5 · X search" };
      }
    } catch {
      // Preserve the saved browser cards when the local collector is unavailable.
    }
  }

  return { value: sampleData.trends, status: "Saved Trending AI" };
}

function validHackerNewsSummaryPayload(
  value: unknown,
  expectedIds: ReadonlySet<string>,
): value is { items: Array<{ id: string; summary: string }> } {
  if (!value || typeof value !== "object") return false;
  const items = (value as { items?: unknown }).items;
  if (!Array.isArray(items) || items.length !== expectedIds.size) return false;
  const seen = new Set<string>();
  return items.every((item) => {
    if (!item || typeof item !== "object") return false;
    const summary = (item as { summary?: unknown }).summary;
    const id = (item as { id?: unknown }).id;
    if (
      typeof id !== "string" ||
      !expectedIds.has(id) ||
      seen.has(id) ||
      typeof summary !== "string" ||
      summary.trim().length < 20 ||
      summary.trim().length > 320
    ) {
      return false;
    }
    seen.add(id);
    return true;
  });
}

async function fetchHackerNews(): Promise<AdapterResult<HackerNewsItem[]>> {
  const now = new Date();
  const selected = await selectRankedHackerNewsStories(async (url) => {
    return (await fetchWithTimeout(url)).json();
  }, now);
  if (selected.length !== 3) {
    throw new Error("Hacker News returned fewer than 3 qualifying AI stories");
  }

  const articleContents = await Promise.all(
    selected.map(async (story) => {
      const url = publicArticleUrl(story.articleUrl);
      if (!url) throw new Error("Hacker News article URL was not public");
      const response = await fetchWithTimeout(
        url,
        12_000,
        { accept: "text/html, text/plain, application/xhtml+xml" },
      );
      return extractReadableArticleText(await response.text());
    }),
  );
  const summaries = new Map<string, string>();
  const collectorUrl = getLocalBridgeUrl("GROK_X_COLLECTOR_URL");
  const collectorToken = getEnvironmentValue("GROK_X_COLLECTOR_TOKEN");

  if (!collectorUrl || !collectorToken) {
    throw new Error("Hacker News full-article summarizer was unavailable");
  }
  const summaryUrl = new URL("/summarize-hn", collectorUrl).toString();
  const payload = (await (
    await fetchWithTimeout(
      summaryUrl,
      42_000,
      {
        authorization: `Bearer ${collectorToken}`,
        "content-type": "application/json",
      },
      {
        method: "POST",
        body: JSON.stringify({
          stories: selected.map((story, index) => ({
            id: String(story.id),
            title: story.title,
            url: story.articleUrl,
            content: articleContents[index],
          })),
        }),
      },
    )
  ).json()) as unknown;
  const expectedIds = new Set(selected.map((story) => String(story.id)));
  if (!validHackerNewsSummaryPayload(payload, expectedIds)) {
    throw new Error("Hacker News full-article summaries were invalid");
  }
  payload.items.forEach((item) => {
    summaries.set(item.id, item.summary.trim());
  });

  return {
    value: selected.map((story) =>
      toHackerNewsItem(story, summaries.get(String(story.id)), now),
    ),
    status: "HN top stories · full-article Grok summaries",
  };
}

async function fetchTechNews(): Promise<AdapterResult<NewsItem[]>> {
  const settled = await Promise.allSettled(
    TECH_FEEDS.map(async ({ source, url }) => {
      const xml = await (await fetchWithTimeout(url)).text();
      const allEntries = source === "The Verge" ? parseAtom(xml) : parseRss(xml);
      const entries = allEntries
        .filter(
          (candidate) =>
            candidate.title &&
            /^https:\/\//.test(candidate.url) &&
            candidate.description,
        )
        .slice(0, TECH_CANDIDATES_PER_SOURCE);
      if (!entries.length) throw new Error("Feed returned no usable articles");

      let selectedEntries = entries;
      let mode: "rss" | "trending" | "popular" = "rss";
      if (source === "Wccftech") {
        try {
          const html = await (
            await fetchWithTimeout(WCCFTECH_HOME_URL)
          ).text();
          const trending = parseWccftechTrendingStories(html, 3);
          if (trending.length === 3) {
            const feedByUrl = new Map(
              allEntries.flatMap((entry) => {
                const canonical = canonicalWccftechUrl(entry.url);
                return canonical ? [[canonical, entry] as const] : [];
              }),
            );
            selectedEntries = trending.map((story) => {
              const feedEntry = feedByUrl.get(story.url);
              return {
                id: feedEntry?.id || story.url,
                title: story.title,
                url: story.url,
                publishedAt:
                  feedEntry?.publishedAt || new Date().toISOString(),
                description:
                  feedEntry?.description ||
                  `Trending #${story.rank} on Wccftech with ${story.activeReaders} active readers.`,
              };
            });
            mode = "trending";
          }
        } catch {
          // The public page can change; newest RSS items remain a safe fallback.
        }
      } else if (source === "The Verge") {
        try {
          const html = await (await fetchWithTimeout(VERGE_HOME_URL)).text();
          const popular = parseVergeMostPopular(html, 5);
          if (popular.length === 5) {
            const feedByUrl = new Map(
              allEntries.flatMap((entry) => {
                const canonical = canonicalVergeUrl(entry.url);
                return canonical ? [[canonical, entry] as const] : [];
              }),
            );
            selectedEntries = await Promise.all(
              popular.map(async (story) => {
                const feedEntry = feedByUrl.get(story.url);
                let description = feedEntry?.description;
                if (!description) {
                  try {
                    const articleHtml = await (
                      await fetchWithTimeout(story.url)
                    ).text();
                    description = parseVergeArticleDescription(articleHtml);
                  } catch {
                    // A concise ranking summary is enough if article metadata fails.
                  }
                }
                return {
                  id: feedEntry?.id || story.url,
                  title: story.title,
                  url: story.url,
                  publishedAt: feedEntry?.publishedAt || story.publishedAt,
                  description:
                    description ||
                    `Ranked #${story.rank} in The Verge Most Popular.`,
                };
              }),
            );
            mode = "popular";
          }
        } catch {
          selectedEntries = entries.slice(0, 5);
        }
      }

      return {
        source,
        mode,
        items: selectedEntries.map((entry) => {
        const summary = concise(entry.description);
        return {
          id: `tech-${stableHash(entry.id)}`,
          title: entry.title,
          summary,
          source,
          age: ageLabel(entry.publishedAt),
          publishedAt: entry.publishedAt,
          contentHash: stableHash(`${entry.title}:${summary}:${entry.url}`),
          destinationUrl: entry.url,
        } satisfies NewsItem;
        }),
      };
    }),
  );

  const liveItems = settled.flatMap((result) =>
    result.status === "fulfilled" ? result.value.items : [],
  );
  const liveSources = new Set(liveItems.map((item) => item.source));
  const wccftechMode = settled.find(
    (result) =>
      result.status === "fulfilled" && result.value.source === "Wccftech",
  );
  const vergeMode = settled.find(
    (result) =>
      result.status === "fulfilled" && result.value.source === "The Verge",
  );
  const savedFallbacks = sampleData.techNews.filter(
    (item) => !liveSources.has(item.source),
  );

  return {
    value: [...liveItems, ...savedFallbacks],
    status:
      liveSources.size === TECH_FEEDS.length
        ? wccftechMode?.status === "fulfilled" &&
          wccftechMode.value.mode === "trending" &&
          vergeMode?.status === "fulfilled" &&
          vergeMode.value.mode === "popular"
          ? "The Verge popular · Wccftech trending · 2 RSS feeds"
          : "4 live sources · ranking fallback active"
        : `${liveSources.size}/${TECH_FEEDS.length} live feeds`,
  };
}

function weatherCondition(code: number): HourForecast["condition"] {
  if (code >= 95) return "Storm";
  if ((code >= 51 && code <= 82) || (code >= 85 && code <= 86)) {
    return "Rain";
  }
  if (code === 0) return "Clear";
  return "Cloudy";
}

function weatherDescription(code: number): string {
  if (code >= 95) return "Thunderstorms";
  if (code >= 71 && code <= 77) return "Snow";
  if ((code >= 51 && code <= 82) || (code >= 85 && code <= 86)) {
    return "Rain";
  }
  if (code === 0) return "Clear";
  if (code <= 3) return "Partly cloudy";
  return "Cloudy";
}

function hourLabel(value: string, isFirst: boolean): string {
  if (isFirst) return "Now";
  const hour = Number(value.slice(11, 13));
  const displayHour = hour % 12 || 12;
  return `${displayHour} ${hour < 12 ? "a.m." : "p.m."}`;
}

async function fetchWeather(): Promise<
  AdapterResult<DashboardData["weather"]>
> {
  const settings = weatherSettings();
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(settings.latitude));
  url.searchParams.set("longitude", String(settings.longitude));
  url.searchParams.set(
    "current",
    "temperature_2m,apparent_temperature,weather_code",
  );
  url.searchParams.set(
    "hourly",
    "temperature_2m,precipitation_probability,weather_code",
  );
  url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min");
  url.searchParams.set("forecast_days", "2");
  url.searchParams.set("timezone", settings.timeZone);

  const payload = (await (await fetchWithTimeout(url.toString())).json()) as {
    current: {
      time: string;
      temperature_2m: number;
      apparent_temperature: number;
      weather_code: number;
    };
    hourly: {
      time: string[];
      temperature_2m: number[];
      precipitation_probability: number[];
      weather_code: number[];
    };
    daily: {
      temperature_2m_max: number[];
      temperature_2m_min: number[];
    };
  };

  const currentHour = payload.current.time.slice(0, 13);
  const startIndex = Math.max(
    0,
    payload.hourly.time.findIndex((value) => value.slice(0, 13) >= currentHour),
  );
  const hours = [0, 2, 4, 6, 8, 10].map((offset, index) => {
    const itemIndex = startIndex + offset;
    return {
      time: hourLabel(payload.hourly.time[itemIndex], index === 0),
      temperature: Math.round(payload.hourly.temperature_2m[itemIndex]),
      condition: weatherCondition(payload.hourly.weather_code[itemIndex]),
      precipitation:
        payload.hourly.precipitation_probability[itemIndex] ?? 0,
    } satisfies HourForecast;
  });

  const badHours = hours.filter(
    (hour) =>
      hour.condition === "Storm" ||
      hour.condition === "Rain" ||
      hour.precipitation >= 60,
  );

  return {
    value: {
      location: settings.location,
      timeZone: settings.timeZone,
      temperature: Math.round(payload.current.temperature_2m),
      feelsLike: Math.round(payload.current.apparent_temperature),
      condition: weatherDescription(payload.current.weather_code),
      high: Math.round(payload.daily.temperature_2m_max[0]),
      low: Math.round(payload.daily.temperature_2m_min[0]),
      alert: badHours.length
        ? `${badHours[0].condition} possible around ${badHours[0].time}`
        : undefined,
      hours,
    },
    status: "Live Open-Meteo",
  };
}

async function fetchTesla(): Promise<AdapterResult<DashboardData["tesla"]>> {
  const payload = (await (
    await fetchWithTimeout(
      "https://query1.finance.yahoo.com/v8/finance/chart/TSLA?range=5d&interval=1d",
    )
  ).json()) as {
    chart?: {
      result?: Array<{
        meta: {
          currency: string;
          regularMarketPrice: number;
          regularMarketTime: number;
          currentTradingPeriod?: {
            regular?: { start: number; end: number };
          };
        };
        indicators?: {
          quote?: Array<{ close?: Array<number | null> }>;
        };
      }>;
    };
  };
  const result = payload.chart?.result?.[0];
  if (!result || result.meta.currency !== "USD") {
    throw new Error("TSLA quote was unavailable or not USD");
  }

  const closes = (result.indicators?.quote?.[0]?.close ?? []).filter(
    (value): value is number => typeof value === "number",
  );
  const price = result.meta.regularMarketPrice;
  const previous = closes.at(-1) ?? price;
  const comparison = Math.abs(previous - price) < 0.005
    ? (closes.at(-2) ?? previous)
    : previous;
  const change = price - comparison;
  const nowSeconds = Date.now() / 1_000;
  const regular = result.meta.currentTradingPeriod?.regular;
  const marketState =
    regular && nowSeconds >= regular.start && nowSeconds <= regular.end
      ? "Market open"
      : "Market closed";

  return {
    value: {
      price,
      change,
      changePercent: comparison ? (change / comparison) * 100 : 0,
      currency: "USD",
      marketState,
      history: [...closes, price].slice(-6),
    },
    status: "Live Yahoo Finance",
  };
}

function isMovie(value: unknown): value is Movie {
  if (!value || typeof value !== "object") return false;
  const movie = value as Partial<Movie>;
  return (
    typeof movie.id === "string" &&
    typeof movie.sourceId === "string" &&
    typeof movie.title === "string" &&
    typeof movie.sourceAddedAt === "string" &&
    typeof movie.originalReleaseDate === "string" &&
    typeof movie.posterUrl === "string" &&
    !("destinationUrl" in movie)
  );
}

async function fetchMovies(): Promise<AdapterResult<Movie[]>> {
  const bridgeUrl = getLocalBridgeUrl("YFSP_MOVIE_FEED_URL");
  const collectorToken = getEnvironmentValue("GROK_X_COLLECTOR_TOKEN");
  if (bridgeUrl && collectorToken) {
    try {
      const payload = (await (
        await fetchWithTimeout(
          bridgeUrl,
          20_000,
          { authorization: `Bearer ${collectorToken}` },
        )
      ).json()) as
        | Movie[]
        | { items?: unknown[] };
      const items = Array.isArray(payload)
        ? payload.filter(isMovie)
        : (payload.items ?? []).filter(isMovie);
      if (items.length === 3) {
        return {
          value: items,
          status: "Live YFSP Recently Added",
        };
      }
    } catch {
      // Preserve the browser's last successful Recently Added list.
    }
  }

  return {
    value: sampleData.movies,
    status: "Saved Recently Added",
  };
}

function isCalendarEvent(value: unknown): value is CalendarEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<CalendarEvent>;
  return (
    typeof event.id === "string" &&
    typeof event.title === "string" &&
    typeof event.startAt === "string" &&
    typeof event.endAt === "string" &&
    typeof event.allDay === "boolean" &&
    typeof event.calendarName === "string" &&
    (event.location === undefined || typeof event.location === "string") &&
    Number.isFinite(Date.parse(event.startAt)) &&
    Number.isFinite(Date.parse(event.endAt))
  );
}

async function fetchCalendar(): Promise<AdapterResult<CalendarEvent[]>> {
  const bridgeUrl = getLocalBridgeUrl("MACOS_CALENDAR_FEED_URL");
  const collectorToken = getEnvironmentValue("GROK_X_COLLECTOR_TOKEN");
  if (!bridgeUrl || !collectorToken) {
    throw new Error("Local Calendar helper is unavailable");
  }
  const response = await fetchWithTimeout(
    bridgeUrl,
    40_000,
    { authorization: `Bearer ${collectorToken}` },
  );
  const payload = (await response.json()) as { items?: unknown[] };
  if (!Array.isArray(payload.items)) {
    throw new Error("Calendar helper returned invalid data");
  }
  return {
    value: payload.items.filter(isCalendarEvent).slice(0, 8),
    status: "Live macOS Calendar",
  };
}

function isLibraryNote(value: unknown): value is LibraryNote {
  if (!value || typeof value !== "object") return false;
  const note = value as Partial<LibraryNote>;
  return (
    typeof note.id === "string" &&
    typeof note.title === "string" &&
    typeof note.savedAt === "string" &&
    Number.isFinite(Date.parse(note.savedAt)) &&
    Array.isArray(note.tags) &&
    note.tags.every((tag) => typeof tag === "string") &&
    typeof note.summary === "string" &&
    typeof note.content === "string"
  );
}

async function fetchLibrary(): Promise<AdapterResult<LibraryNote[]>> {
  const bridgeUrl = getLocalBridgeUrl("AGENT_NOTE_LIBRARY_FEED_URL");
  const collectorToken = getEnvironmentValue("GROK_X_COLLECTOR_TOKEN");
  if (!bridgeUrl || !collectorToken) {
    throw new Error("Local Agent-note helper is unavailable");
  }

  const response = await fetchWithTimeout(
    bridgeUrl,
    30_000,
    { authorization: `Bearer ${collectorToken}` },
  );
  const payload = (await response.json()) as { items?: unknown[] };
  if (!Array.isArray(payload.items)) {
    throw new Error("Agent-note helper returned invalid data");
  }
  const items = payload.items.filter(isLibraryNote);
  return {
    value: items,
    status: items.length
      ? `Agent-note · ${items.length} saved`
      : "Agent-note · No recent notes",
  };
}

async function resolved<T>(
  live: Promise<AdapterResult<T>>,
  fallback: T,
  fallbackStatus: string,
): Promise<AdapterResult<T>> {
  try {
    return await live;
  } catch {
    return { value: fallback, status: fallbackStatus };
  }
}

export async function getLiveDashboard(): Promise<DashboardData> {
  const [x, hn, tech, market, weather, calendar, movies, library] =
    await Promise.all([
    resolved(fetchXExplore(), sampleData.trends, "Saved Trending AI"),
    resolved(fetchHackerNews(), sampleData.hnTrends, "Saved Hacker News"),
    resolved(fetchTechNews(), sampleData.techNews, "Saved feeds"),
    resolved(fetchTesla(), sampleData.tesla, "Saved quote"),
    resolved(fetchWeather(), sampleData.weather, "Saved forecast"),
    resolved(fetchCalendar(), sampleData.schedule, "Saved schedule"),
    resolved(fetchMovies(), sampleData.movies, "Saved Recently Added"),
    resolved(fetchLibrary(), sampleData.library, "Agent-note unavailable"),
    ]);

  return {
    savedAt: new Date().toISOString(),
    profile: dashboardProfile(),
    sourceStatus: {
      x: x.status,
      hn: hn.status,
      tech: tech.status,
      market: market.status,
      weather: weather.status,
      calendar: calendar.status,
      movies: movies.status,
      library: library.status,
    },
    trends: x.value,
    hnTrends: hn.value,
    techNews: tech.value,
    tesla: market.value,
    weather: weather.value,
    schedule: calendar.value,
    movies: movies.value,
    library: library.value,
  };
}
