import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const mode = process.argv[2];
if (mode !== "dev" && mode !== "start") {
  console.error("Usage: node scripts/run-local.mjs <dev|start>");
  process.exit(1);
}

const port = process.env.GROK_X_COLLECTOR_PORT ?? "8788";
const token = randomBytes(32).toString("hex");
const collectorUrl = `http://127.0.0.1:${port}/x-trending-ai`;
const movieUrl = `http://127.0.0.1:${port}/yfsp-recent-movies`;
const calendarUrl = `http://127.0.0.1:${port}/calendar-events`;
const environment = {
  ...process.env,
  GROK_X_COLLECTOR_PORT: port,
  GROK_X_COLLECTOR_TOKEN: token,
  GROK_X_COLLECTOR_URL: collectorUrl,
  YFSP_MOVIE_FEED_URL: movieUrl,
  MACOS_CALENDAR_FEED_URL: calendarUrl,
};

let stopping = false;
let app;
const collector = spawn(
  process.execPath,
  ["scripts/grok-x-collector.mjs"],
  { cwd: process.cwd(), env: environment, stdio: "inherit" },
);

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  if (app && !app.killed) app.kill("SIGTERM");
  if (!collector.killed) collector.kill("SIGTERM");
  process.exitCode = exitCode;
}

process.on("SIGINT", () => stop(130));
process.on("SIGTERM", () => stop(143));

collector.on("exit", (code, signal) => {
  if (!stopping) {
    console.error(
      `Local Grok collector stopped unexpectedly (${signal ?? code ?? "unknown"}).`,
    );
    stop(code ?? 1);
  }
});

async function waitForCollector() {
  const healthUrl = `http://127.0.0.1:${port}/health`;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (collector.exitCode !== null) {
      throw new Error("Local Grok collector could not start");
    }
    try {
      const response = await fetch(healthUrl, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (response.ok) return;
    } catch {
      // The loopback server may still be binding.
    }
    await delay(100);
  }
  throw new Error("Timed out starting the local Grok collector");
}

try {
  await waitForCollector();
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
