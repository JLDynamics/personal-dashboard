import { getLiveDashboard } from "../../data/live-adapters";
import type { DashboardData } from "../../data/types";

export const dynamic = "force-dynamic";

const BACKGROUND_CACHE_MS = 60_000;
let cachedData: DashboardData | undefined;
let cachedAt = 0;
let refreshInFlight: Promise<DashboardData> | undefined;

function localCacheSettings() {
  const rawUrl = process.env.DASHBOARD_CACHE_URL?.trim();
  const token = process.env.DASHBOARD_LOCAL_TOKEN?.trim();
  if (!rawUrl || !token) return undefined;
  try {
    const url = new URL(rawUrl);
    if (
      url.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "::1"].includes(url.hostname)
    ) {
      return undefined;
    }
    return { url, token };
  } catch {
    return undefined;
  }
}

async function readLocalCache(force: boolean): Promise<DashboardData | undefined> {
  const settings = localCacheSettings();
  if (!settings) return undefined;
  const url = new URL(force ? "/refresh?scope=full" : "/snapshot", settings.url);
  try {
    const response = await fetch(url, {
      method: force ? "POST" : "GET",
      cache: "no-store",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${settings.token}`,
      },
    });
    if (!response.ok) return undefined;
    const payload = (await response.json()) as
      | DashboardData
      | { snapshot?: DashboardData };
    if ("snapshot" in payload) {
      return (payload as { snapshot?: DashboardData }).snapshot;
    }
    return payload as DashboardData;
  } catch {
    return undefined;
  }
}

async function readLiveData(force: boolean) {
  const cacheFresh =
    cachedData && Date.now() - cachedAt < BACKGROUND_CACHE_MS;
  if (!force && cacheFresh) return cachedData;
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () =>
    (await readLocalCache(force)) ?? getLiveDashboard())();
  try {
    cachedData = await refreshInFlight;
    cachedAt = Date.now();
    return cachedData;
  } finally {
    refreshInFlight = undefined;
  }
}

export async function GET(request: Request) {
  const force = new URL(request.url).searchParams.get("force") === "1";
  const data = await readLiveData(force);

  return Response.json(data, {
    headers: {
      "cache-control": "no-store",
    },
  });
}
