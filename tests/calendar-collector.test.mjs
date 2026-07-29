import assert from "node:assert/strict";
import test from "node:test";

import {
  CALENDAR_EVENT_LIMIT,
  calendarCompilerArguments,
  validateCalendarPayload,
} from "../scripts/calendar-collector.mjs";

test("validates, deduplicates, sorts, and caps macOS Calendar events", () => {
  const items = Array.from({ length: 10 }, (_, index) => ({
    id: `event-${index}`,
    title: `Event ${index}`,
    startAt: new Date(
      Date.UTC(2026, 6, 30, 20 - index),
    ).toISOString(),
    endAt: new Date(
      Date.UTC(2026, 6, 30, 21 - index),
    ).toISOString(),
    allDay: false,
    calendarName: "Home",
    location: index === 0 ? "Sample location\nPrivate extra line" : "",
  }));
  items.push({ ...items[0], id: "duplicate" });
  items.push({ id: "bad", title: "", startAt: "invalid" });

  const result = validateCalendarPayload({ items });
  assert.equal(result.items.length, CALENDAR_EVENT_LIMIT);
  assert.deepEqual(
    result.items.map((item) => item.startAt),
    [...result.items.map((item) => item.startAt)].sort(),
  );
  assert.equal(
    result.items.filter((item) => item.title === "Event 0").length,
    0,
  );
});

test("uses the native EventKit compiler without external dependencies", () => {
  const args = calendarCompilerArguments("/tmp/source.m", "/tmp/calendar");
  assert.deepEqual(args.slice(0, 2), ["clang", "-fobjc-arc"]);
  assert.ok(args.includes("EventKit"));
  assert.equal(args.at(-1), "/tmp/calendar");
});
