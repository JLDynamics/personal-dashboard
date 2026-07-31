import assert from "node:assert/strict";
import test from "node:test";

import { sampleData } from "../app/data/sample-data.ts";
import {
  DEFAULT_DASHBOARD_TIME_ZONE,
  formatDashboardClock,
  resolveDashboardTimeZone,
  withResolvedDashboardTimeZone,
} from "../app/data/dashboard-time-zone.ts";

test("defaults to Alberta time and retains a valid configured timezone", () => {
  assert.equal(resolveDashboardTimeZone(), DEFAULT_DASHBOARD_TIME_ZONE);
  assert.equal(
    resolveDashboardTimeZone("not/a-real-timezone"),
    DEFAULT_DASHBOARD_TIME_ZONE,
  );
  assert.equal(resolveDashboardTimeZone("America/Toronto"), "America/Toronto");
});

test("normalizes cached weather and formats schedule instants in the same timezone", () => {
  const cached = structuredClone(sampleData);
  cached.weather.timeZone = "UTC";
  const normalized = withResolvedDashboardTimeZone(cached);

  assert.equal(normalized.weather.timeZone, "America/Edmonton");
  assert.equal(
    formatDashboardClock("2026-07-31T17:00:00.000Z", normalized.weather.timeZone),
    "11:00 a.m.",
  );
  assert.equal(cached.weather.timeZone, "UTC");
});
