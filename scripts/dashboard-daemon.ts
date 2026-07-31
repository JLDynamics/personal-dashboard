import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";

import {
  DashboardCache,
  DEFAULT_DATABASE_PATH,
} from "./dashboard-cache.mjs";
import {
  getLiveAdapterDiagnostics,
  getLiveDashboardForScope,
  type DashboardRefreshScope,
} from "../app/data/live-adapters";
import { sampleData } from "../app/data/sample-data";
import type { DashboardData } from "../app/data/types";

export const DEFAULT_DAEMON_PORT = 8790;
const SCHEDULER_TICK_MS = 60_000;
const VALID_SCOPES = new Set<DashboardRefreshScope>([
  "full",
  "news",
  "market",
  "weather",
  "calendar",
  "movies",
  "library",
]);
const SCHEDULED_SCOPES: DashboardRefreshScope[] = [
  "news",
  "market",
  "weather",
  "calendar",
  "movies",
  "library",
];

function jsonResponse(
  response: ServerResponse,
  status: number,
  payload: unknown,
) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": "application/json; charset=utf-8",
  });
  response.end(body);
}

function requestScope(request: IncomingMessage): DashboardRefreshScope {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const value = url.searchParams.get("scope") as DashboardRefreshScope | null;
  return value && VALID_SCOPES.has(value) ? value : "full";
}

export function createDashboardDaemon({
  token,
  cache = new DashboardCache(
    process.env.DASHBOARD_DATABASE_PATH?.trim() || DEFAULT_DATABASE_PATH,
  ),
  refreshLive = getLiveDashboardForScope,
}: {
  token: string;
  cache?: DashboardCache;
  refreshLive?: (
    current: DashboardData,
    scope: DashboardRefreshScope,
  ) => Promise<DashboardData>;
}) {
  if (!token) throw new Error("DASHBOARD_LOCAL_TOKEN is required");
  const inFlight = new Map<
    DashboardRefreshScope,
    Promise<ReturnType<DashboardCache["storeRefresh"]>>
  >();

  async function refresh(scope: DashboardRefreshScope) {
    const existing = inFlight.get(scope);
    if (existing) return existing;

    const pending = (async () => {
      const current = cache.readSnapshot() ?? sampleData;
      const incoming = await refreshLive(current, scope);
      return cache.storeRefresh(incoming, scope);
    })().finally(() => {
      inFlight.delete(scope);
    });
    inFlight.set(scope, pending);
    return pending;
  }

  async function runScheduledRefreshes() {
    const dueScopes = SCHEDULED_SCOPES.filter((scope) =>
      cache.isScopeDue(scope),
    );
    await Promise.allSettled(dueScopes.map((scope) => refresh(scope)));
  }

  const server = createServer(async (request, response) => {
    if (request.headers.authorization !== `Bearer ${token}`) {
      jsonResponse(response, 401, { error: "Unauthorized" });
      return;
    }

    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/health") {
      jsonResponse(response, 200, {
        ok: true,
        database: "SQLite",
        snapshotReady: Boolean(cache.readSnapshot()),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/snapshot") {
      try {
        const snapshot = cache.readSnapshot() ?? (await refresh("full")).snapshot;
        jsonResponse(response, 200, snapshot);
      } catch {
        jsonResponse(response, 503, {
          error: "Dashboard cache is temporarily unavailable",
        });
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/status") {
      jsonResponse(response, 200, {
        sources: cache.readSourceStates(),
        diagnostics: getLiveAdapterDiagnostics(),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/refresh") {
      try {
        const result = await refresh(requestScope(request));
        jsonResponse(response, 200, result);
      } catch {
        jsonResponse(response, 503, {
          error: "Dashboard refresh is temporarily unavailable",
        });
      }
      return;
    }

    jsonResponse(response, 404, { error: "Not found" });
  });

  let scheduler: NodeJS.Timeout | undefined;
  return {
    cache,
    server,
    refresh,
    async start(port = DEFAULT_DAEMON_PORT) {
      if (!cache.readSnapshot()) await refresh("full");
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          server.off("error", reject);
          resolve();
        });
      });
      scheduler = setInterval(() => {
        void runScheduledRefreshes().catch(() => {
          // The current snapshot remains available after a scheduled failure.
        });
      }, SCHEDULER_TICK_MS);
      scheduler.unref();
    },
    async close() {
      if (scheduler) clearInterval(scheduler);
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      cache.close();
    },
  };
}

async function main() {
  const token = process.env.DASHBOARD_LOCAL_TOKEN?.trim();
  if (!token) {
    console.error(
      "DASHBOARD_LOCAL_TOKEN is missing. Start the dashboard with npm run dev.",
    );
    process.exitCode = 1;
    return;
  }
  const port = Number(process.env.DASHBOARD_DAEMON_PORT ?? DEFAULT_DAEMON_PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    console.error("DASHBOARD_DAEMON_PORT must be a valid local port.");
    process.exitCode = 1;
    return;
  }

  const daemon = createDashboardDaemon({ token });
  await daemon.start(port);
  console.log(`Local dashboard cache ready on 127.0.0.1:${port}`);

  const stop = () => {
    void daemon.close().finally(() => {
      process.exitCode = 0;
    });
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
