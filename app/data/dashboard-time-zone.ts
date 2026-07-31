import type { DashboardData } from "./types";

export const DEFAULT_DASHBOARD_TIME_ZONE = "America/Edmonton";

export function resolveDashboardTimeZone(configuredTimeZone?: string): string {
  const candidate = configuredTimeZone?.trim();
  if (!candidate) return DEFAULT_DASHBOARD_TIME_ZONE;

  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: candidate });
    return candidate;
  } catch {
    return DEFAULT_DASHBOARD_TIME_ZONE;
  }
}

export function withResolvedDashboardTimeZone(
  data: DashboardData,
  configuredTimeZone?: string,
): DashboardData {
  return {
    ...data,
    weather: {
      ...data.weather,
      timeZone: resolveDashboardTimeZone(configuredTimeZone),
    },
  };
}

export function formatDashboardClock(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: resolveDashboardTimeZone(timeZone),
  }).format(new Date(value));
}
