import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const mode = process.argv[2];
if (mode !== "dev" && mode !== "start") {
  console.error("Usage: node scripts/run-local.mjs <dev|start>");
  process.exit(1);
}

const collectorPort = process.env.GROK_X_COLLECTOR_PORT ?? "8788";
const daemonPort = process.env.DASHBOARD_DAEMON_PORT ?? "8790";
const collectorToken = randomBytes(32).toString("hex");
const dashboardToken = randomBytes(32).toString("hex");
const collectorUrl = `http://127.0.0.1:${collectorPort}/x-trending-ai`;
const movieUrl = `http://127.0.0.1:${collectorPort}/yfsp-recent-movies`;
const calendarUrl = `http://127.0.0.1:${collectorPort}/calendar-events`;
const libraryUrl = `http://127.0.0.1:${collectorPort}/local-notes-library`;
const cacheUrl = `http://127.0.0.1:${daemonPort}`;
const environment = {
  ...process.env,
  GROK_X_COLLECTOR_PORT: collectorPort,
  GROK_X_COLLECTOR_TOKEN: collectorToken,
  GROK_X_COLLECTOR_URL: collectorUrl,
  YFSP_MOVIE_FEED_URL: movieUrl,
  MACOS_CALENDAR_FEED_URL: calendarUrl,
  DASHBOARD_NOTES_LIBRARY_FEED_URL: libraryUrl,
  DASHBOARD_DAEMON_PORT: daemonPort,
  DASHBOARD_CACHE_URL: cacheUrl,
  DASHBOARD_LOCAL_TOKEN: dashboardToken,
};

let stopping = false;
let app;
const children = [];

function spawnChild(command, args) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: environment,
    stdio: "inherit",
  });
  children.push(child);
  child.on("exit", (code, signal) => {
    if (!stopping) {
      console.error(
        `Local dashboard service stopped unexpectedly (${signal ?? code ?? "unknown"}).`,
      );
      stop(code ?? 1);
    }
  });
  child.on("error", () => stop(1));
  return child;
}

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  if (app && !app.killed) app.kill("SIGTERM");
  children.forEach((child) => {
    if (!child.killed) child.kill("SIGTERM");
  });
  process.exitCode = exitCode;
}

process.on("SIGINT", () => stop(130));
process.on("SIGTERM", () => stop(143));

async function waitForService(url, token, child, attempts = 900) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error("A local dashboard service could not start");
    }
    try {
      const response = await fetch(url, {
        headers: token ? { authorization: `Bearer ${token}` } : undefined,
      });
      if (response.ok) return;
    } catch {
      // The loopback service may still be binding or preparing its cache.
    }
    await delay(100);
  }
  throw new Error("Timed out starting a local dashboard service");
}

try {
  const collector = spawnChild(process.execPath, [
    "scripts/grok-x-collector.mjs",
  ]);
  await waitForService(
    `http://127.0.0.1:${collectorPort}/health`,
    collectorToken,
    collector,
    400,
  );

  const daemon = spawnChild(process.execPath, [
    "--import",
    "tsx",
    "scripts/dashboard-daemon.ts",
  ]);
  await waitForService(
    `http://127.0.0.1:${daemonPort}/health`,
    dashboardToken,
    daemon,
  );

  app = spawn("vinext", [mode], {
    cwd: process.cwd(),
    env: environment,
    stdio: "inherit",
  });
  app.on("exit", (code) => stop(code ?? 0));
  app.on("error", () => stop(1));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  stop(1);
}
