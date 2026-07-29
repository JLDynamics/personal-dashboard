import type { DashboardData } from "./types";

function mergeUniqueBy<T>(
  next: T[],
  saved: T[],
  key: (item: T) => string,
): T[] {
  const seen = new Set(next.map(key));
  return [...next, ...saved.filter((item) => !seen.has(key(item)))];
}

function headlineTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((token) => token.length > 3),
  );
}

function likelySameHeadline(left: string, right: string): boolean {
  const leftTokens = headlineTokens(left);
  const rightTokens = headlineTokens(right);
  if (leftTokens.size < 3 || rightTokens.size < 3) return false;
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return overlap / Math.min(leftTokens.size, rightTokens.size) >= 0.8;
}

function mergeHackerNews(
  live: DashboardData["hnTrends"],
  saved: DashboardData["hnTrends"],
  xItems: DashboardData["trends"],
): DashboardData["hnTrends"] {
  const candidates = mergeUniqueBy(
    live,
    saved,
    (item) => item.destinationUrl,
  );
  const preferred = candidates.filter(
    (item) =>
      !xItems.some((xItem) => likelySameHeadline(item.title, xItem.title)),
  );
  const crossSourceDuplicates = candidates.filter(
    (item) => !preferred.includes(item),
  );
  return [...preferred, ...crossSourceDuplicates].slice(0, 3);
}

export function mergeTrendingSources({
  newXItems,
  liveHnItems,
  currentXItems,
  currentHnItems,
  xUnavailable,
  hnUnavailable,
}: {
  newXItems: DashboardData["trends"];
  liveHnItems: DashboardData["hnTrends"];
  currentXItems: DashboardData["trends"];
  currentHnItems: DashboardData["hnTrends"];
  xUnavailable: boolean;
  hnUnavailable: boolean;
}): Pick<DashboardData, "trends" | "hnTrends"> {
  const trends = xUnavailable
    ? currentXItems
    : mergeUniqueBy(
        newXItems,
        currentXItems,
        (item) => item.destinationUrl,
      ).slice(0, 3);

  return {
    trends,
    hnTrends: hnUnavailable
      ? currentHnItems
      : mergeHackerNews(liveHnItems, currentHnItems, trends),
  };
}
