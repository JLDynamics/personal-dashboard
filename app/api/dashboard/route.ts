import { getLiveDashboard } from "../../data/live-adapters";
import type { DashboardData } from "../../data/types";

export const dynamic = "force-dynamic";

const BACKGROUND_CACHE_MS = 60_000;
let cachedData: DashboardData | undefined;
let cachedAt = 0;
let refreshInFlight: Promise<DashboardData> | undefined;

async function readLiveData(force: boolean) {
  const cacheFresh =
    cachedData && Date.now() - cachedAt < BACKGROUND_CACHE_MS;
  if (!force && cacheFresh) return cachedData;
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = getLiveDashboard();
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
