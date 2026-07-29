import { execFile } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const CALENDAR_TIMEOUT_MS = 35_000;
export const CALENDAR_EVENT_LIMIT = 8;

const SOURCE_PATH = fileURLToPath(
  new URL("./calendar-events.m", import.meta.url),
);
const BINARY_PATH = fileURLToPath(
  new URL("../.local/calendar-helper/calendar-events", import.meta.url),
);
const MODULE_CACHE_PATH = `${tmpdir()}/jack-dashboard-clang-cache`;

function executeFile(executable, args, options) {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      args,
      {
        encoding: "utf8",
        maxBuffer: 512_000,
        killSignal: "SIGKILL",
        ...options,
      },
      (error, stdout, stderr) => {
        if (error) reject(error);
        else resolve({ stdout, stderr });
      },
    );
  });
}

export function calendarCompilerArguments(
  sourcePath = SOURCE_PATH,
  binaryPath = BINARY_PATH,
) {
  return [
    "clang",
    "-fobjc-arc",
    "-framework",
    "Foundation",
    "-framework",
    "EventKit",
    sourcePath,
    "-o",
    binaryPath,
  ];
}

async function ensureCalendarHelper(execute = executeFile) {
  await mkdir(dirname(BINARY_PATH), { recursive: true });
  let rebuild;
  try {
    const [source, binary] = await Promise.all([
      stat(SOURCE_PATH),
      stat(BINARY_PATH),
    ]);
    rebuild = binary.mtimeMs < source.mtimeMs;
  } catch {
    rebuild = true;
  }
  if (!rebuild) return;

  await execute("/usr/bin/xcrun", calendarCompilerArguments(), {
    env: {
      ...process.env,
      CLANG_MODULE_CACHE_PATH: MODULE_CACHE_PATH,
    },
    timeout: 30_000,
  });
}

function cleanText(value, limit) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

export function validateCalendarPayload(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.items)) {
    throw new Error("Calendar payload did not contain an items array");
  }

  const seen = new Set();
  const items = [];
  for (const raw of payload.items) {
    if (!raw || typeof raw !== "object") continue;
    const id = cleanText(raw.id, 180);
    const title = cleanText(raw.title, 180);
    const calendarName = cleanText(raw.calendarName, 80);
    const location = cleanText(raw.location, 140);
    const startAt = cleanText(raw.startAt, 40);
    const endAt = cleanText(raw.endAt, 40);
    const startTime = Date.parse(startAt);
    const endTime = Date.parse(endAt);
    if (
      !id ||
      !title ||
      !calendarName ||
      !Number.isFinite(startTime) ||
      !Number.isFinite(endTime) ||
      endTime < startTime ||
      typeof raw.allDay !== "boolean"
    ) {
      continue;
    }
    const key = `${title.toLowerCase()}:${startAt}:${endAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      id,
      title,
      startAt: new Date(startTime).toISOString(),
      endAt: new Date(endTime).toISOString(),
      allDay: raw.allDay,
      calendarName,
      ...(location ? { location } : {}),
    });
  }

  return {
    items: items
      .sort((left, right) => left.startAt.localeCompare(right.startAt))
      .slice(0, CALENDAR_EVENT_LIMIT),
  };
}

export async function collectMacCalendarEvents({
  execute = executeFile,
} = {}) {
  await ensureCalendarHelper(execute);
  const { stdout } = await execute(BINARY_PATH, [], {
    timeout: CALENDAR_TIMEOUT_MS,
  });
  return validateCalendarPayload(JSON.parse(stdout));
}
