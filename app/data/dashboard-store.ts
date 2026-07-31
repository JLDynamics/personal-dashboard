import { sampleData } from "./sample-data";
import {
  mergeTrendingSources,
  normalizeLibraryNotes,
} from "./dashboard-merge";
import {
  candidatesForOptionalAiReview,
  filterNewAiCandidates,
} from "./refresh-policy";
import {
  readTechPreferenceProfile,
  selectDiverseTechNews,
} from "./tech-news-selection";
import type { DashboardData } from "./types";

const CACHE_KEY = "local-daily-dashboard-v1";
const REFRESH_META_KEY = "local-daily-dashboard-refresh-meta-v1";

type LegacyNewsItem = DashboardData["trends"][number] & { url?: string };
type RefreshMetadata = {
  seenFingerprints: string[];
  lastRun: string;
  lastCandidateCount: number;
  lastNewCount: number;
  lastSkippedSeen: number;
  lastRejectedByRules: number;
};

function normalizeSavedDashboard(saved: DashboardData): DashboardData {
  const canonicalTrends = new Map(sampleData.trends.map((item) => [item.id, item]));
  const canonicalHn = new Map(sampleData.hnTrends.map((item) => [item.id, item]));
  const canonicalTech = new Map(sampleData.techNews.map((item) => [item.id, item]));
  const canonicalMovies = new Map(sampleData.movies.map((item) => [item.id, item]));

  function normalizeNews(
    items: LegacyNewsItem[],
    canonicalItems: Map<string, DashboardData["trends"][number]>,
  ) {
    return items.map((item) => ({
      ...item,
      ...canonicalItems.get(item.id),
      destinationUrl:
        canonicalItems.get(item.id)?.destinationUrl ??
        item.destinationUrl ??
        item.url ??
        "",
    }));
  }

  return {
    ...saved,
    profile: {
      ...sampleData.profile,
      ...(saved.profile ?? {}),
    },
    sourceStatus: {
      ...sampleData.sourceStatus,
      ...(saved.sourceStatus ?? {}),
    },
    trends: normalizeNews(saved.trends as LegacyNewsItem[], canonicalTrends),
    hnTrends: (saved.hnTrends ?? sampleData.hnTrends).map((item) => ({
      ...item,
      ...canonicalHn.get(item.id),
    })),
    techNews: normalizeNews(saved.techNews as LegacyNewsItem[], canonicalTech),
    weather: {
      ...sampleData.weather,
      ...saved.weather,
    },
    schedule: saved.schedule ?? sampleData.schedule,
    library: normalizeLibraryNotes(
      (saved as DashboardData & { library?: unknown }).library,
    ),
    movies: saved.movies.map((movie) => ({
      ...movie,
      ...canonicalMovies.get(movie.id),
    })),
  };
}

function readRefreshMetadata(): RefreshMetadata {
  try {
    const raw = window.localStorage.getItem(REFRESH_META_KEY);
    if (raw) return JSON.parse(raw) as RefreshMetadata;
  } catch {
    // A missing or unreadable cache is equivalent to a first refresh.
  }

  return {
    seenFingerprints: [],
    lastRun: "",
    lastCandidateCount: 0,
    lastNewCount: 0,
    lastSkippedSeen: 0,
    lastRejectedByRules: 0,
  };
}

export function readSavedDashboard(): DashboardData {
  if (typeof window === "undefined") return sampleData;

  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    return raw
      ? normalizeSavedDashboard(JSON.parse(raw) as DashboardData)
      : sampleData;
  } catch {
    return sampleData;
  }
}

export async function refreshDashboard(
  current: DashboardData,
  force = false,
): Promise<DashboardData> {
  let liveData: DashboardData;
  try {
    const response = await fetch(
      force ? "/api/dashboard?force=1" : "/api/dashboard",
      {
      cache: "no-store",
      headers: { accept: "application/json" },
      },
    );
    if (!response.ok) throw new Error("Live refresh failed");
    liveData = (await response.json()) as DashboardData;
  } catch {
    return current;
  }

  const refreshMetadata = readRefreshMetadata();
  const xUnavailable = liveData.sourceStatus.x === "Saved Trending AI";
  const hnUnavailable = liveData.sourceStatus.hn === "Saved Hacker News";
  const techUnavailable =
    liveData.sourceStatus.tech === "Saved feeds" ||
    liveData.sourceStatus.tech.startsWith("0/");
  const moviesUnavailable =
    liveData.sourceStatus.movies === "Saved Recently Added";
  const calendarUnavailable =
    liveData.sourceStatus.calendar === "Saved schedule";
  const libraryUnavailable =
    liveData.sourceStatus.library === "Notes folder unavailable";
  const filteredAi = filterNewAiCandidates(
    xUnavailable ? [] : liveData.trends,
    new Set(refreshMetadata.seenFingerprints),
  );
  const newAiItems = candidatesForOptionalAiReview(filteredAi);
  const seenFingerprints = new Set(refreshMetadata.seenFingerprints);
  filteredAi.observedFingerprints.forEach((value) => seenFingerprints.add(value));

  const mergedTrends = mergeTrendingSources({
    newXItems: newAiItems,
    liveHnItems: liveData.hnTrends,
    currentXItems: current.trends,
    currentHnItems: current.hnTrends ?? sampleData.hnTrends,
    xUnavailable,
    hnUnavailable,
  });
  const diverseTechNews = techUnavailable
    ? current.techNews
    : selectDiverseTechNews(
        [...liveData.techNews, ...current.techNews],
        readTechPreferenceProfile(),
      );

  const next: DashboardData = {
    ...liveData,
    ...mergedTrends,
    sourceStatus: {
      ...liveData.sourceStatus,
      tech: techUnavailable
        ? "Saved discovery mix"
        : liveData.sourceStatus.tech.startsWith("The Verge popular")
          ? "2 site rankings · learns locally"
          : "Diverse mix · learns locally",
    },
    techNews: diverseTechNews,
    schedule: calendarUnavailable ? current.schedule : liveData.schedule,
    library: libraryUnavailable ? current.library : liveData.library,
    movies: moviesUnavailable ? current.movies : liveData.movies.slice(0, 3),
  };

  if (libraryUnavailable && current.library.length) {
    next.sourceStatus.library = "Saved library · Notes folder unavailable";
  }

  window.localStorage.setItem(CACHE_KEY, JSON.stringify(next));
  window.localStorage.setItem(
    REFRESH_META_KEY,
    JSON.stringify({
      seenFingerprints: [...seenFingerprints],
      lastRun: next.savedAt,
      lastCandidateCount: filteredAi.candidateCount,
      lastNewCount: newAiItems.length,
      lastSkippedSeen: filteredAi.skippedSeen,
      lastRejectedByRules: filteredAi.rejectedByRules,
    } satisfies RefreshMetadata),
  );
  return next;
}
