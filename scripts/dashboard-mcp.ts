import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { pathToFileURL } from "node:url";

import {
  hostHeaderValidation,
  localhostHostValidation,
  localhostOriginValidation,
  originValidation,
  toNodeHandler,
  toWebRequest,
} from "@modelcontextprotocol/node";
import {
  createMcpHandler,
  McpServer,
  requireBearerAuth,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import {
  DashboardCache,
  DEFAULT_DATABASE_PATH,
} from "./dashboard-cache.mjs";
import { askDashboard, DashboardAnswerState } from "./dashboard-answer.mjs";
import {
  Auth0JwtVerifier,
  DashboardRemoteSettings,
  RemoteConfigurationError,
} from "./dashboard-remote-auth.ts";

export const DASHBOARD_MCP_PORT = 8791;
export const ASK_DASHBOARD_TOOL = "ask_dashboard";

const answerSchema = z.object({
  answer: z.string(),
  asOf: z.string(),
  usedSections: z.array(z.string()),
  sources: z.array(z.string()),
});

export function buildDashboardMcpServer({
  cache,
  answer = askDashboard,
  answerState = new DashboardAnswerState(),
}: {
  cache: DashboardCache;
  answer?: typeof askDashboard;
  answerState?: DashboardAnswerState;
}) {
  const server = new McpServer(
    {
      name: "Personal Dashboard",
      version: "0.1.0",
    },
    {
      instructions:
        "Use ask_dashboard for questions about the owner's cached personal dashboard. " +
        "The tool is read-only and answers from cached data only.",
    },
  );

  server.registerTool(
    ASK_DASHBOARD_TOOL,
    {
      title: "Ask My Dashboard",
      description:
        "Answer one question from the latest cached dashboard data. Trending AI and Tech News lists are formatted directly from that snapshot; other questions use the local Grok CLI.",
      inputSchema: z.object({
        question: z
          .string()
          .min(1)
          .max(1_000)
          .describe("The question to answer from cached dashboard data."),
        callerId: z
          .string()
          .min(1)
          .max(256)
          .optional()
          .describe(
            "An opaque, stable ID for this caller or conversation. Supply the same value for Tech News follow-ups such as 'show more tech news'.",
          ),
      }),
      outputSchema: answerSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ question, callerId }) => {
      const snapshot = cache.readSnapshot();
      if (!snapshot) {
        return {
          content: [
            {
              type: "text",
              text: "The dashboard cache is not ready yet.",
            },
          ],
          isError: true,
        };
      }

      try {
        const output = await answer(question, snapshot, {
          callerId,
          state: answerState,
        });
        return {
          content: [{ type: "text", text: output.answer }],
          structuredContent: output,
        };
      } catch {
        return {
          content: [
            {
              type: "text",
              text: "The local dashboard answer service is temporarily unavailable.",
            },
          ],
          isError: true,
        };
      }
    },
  );

  return server;
}

export function createLocalDashboardMcp({
  cache = new DashboardCache(
    process.env.DASHBOARD_DATABASE_PATH?.trim() || DEFAULT_DATABASE_PATH,
  ),
} = {}) {
  const handler = createMcpHandler(
    () => buildDashboardMcpServer({ cache }),
    { responseMode: "json" },
  );
  const nodeHandler = toNodeHandler(handler);
  const validateHost = localhostHostValidation();
  const validateOrigin = localhostOriginValidation();

  const httpServer = createServer((request, response) => {
    if (!validateHost(request, response) || !validateOrigin(request, response)) {
      return;
    }

    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/health") {
      const body = JSON.stringify({
        ok: true,
        protocol: "2026-07-28",
        cacheReady: Boolean(cache.readSnapshot()),
      });
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-length": Buffer.byteLength(body),
        "content-type": "application/json; charset=utf-8",
      });
      response.end(body);
      return;
    }

    if (url.pathname !== "/mcp") {
      response.writeHead(404);
      response.end();
      return;
    }
    void nodeHandler(request, response);
  });

  return {
    cache,
    handler,
    httpServer,
    async start(port = DASHBOARD_MCP_PORT) {
      await new Promise<void>((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(port, "127.0.0.1", () => {
          httpServer.off("error", reject);
          resolve();
        });
      });
    },
    async close() {
      await handler.close();
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
      cache.close();
    },
  };
}

async function writeWebResponse(
  response: ServerResponse,
  webResponse: Response,
) {
  const headers = Object.fromEntries(webResponse.headers);
  response.writeHead(webResponse.status, headers);
  if (!webResponse.body) {
    response.end();
    return;
  }
  const reader = webResponse.body.getReader();
  while (true) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    response.write(chunk);
  }
  response.end();
}

function requestUrl(request: IncomingMessage) {
  return new URL(request.url ?? "/", "http://127.0.0.1");
}

export function createRemoteDashboardMcp({
  settings,
  cache = new DashboardCache(
    process.env.DASHBOARD_DATABASE_PATH?.trim() || DEFAULT_DATABASE_PATH,
  ),
  verifier = new Auth0JwtVerifier(settings),
}: {
  settings: DashboardRemoteSettings;
  cache?: DashboardCache;
  verifier?: OAuthTokenVerifier;
}) {
  settings.validate();
  const handler = createMcpHandler(
    () => buildDashboardMcpServer({ cache }),
    { responseMode: "json" },
  );
  const requireAuth = requireBearerAuth({
    verifier,
    requiredScopes: settings.requiredScope ? [settings.requiredScope] : [],
    resourceMetadataUrl: settings.protectedResourceMetadataUrl.href,
  });
  const validateHost = hostHeaderValidation([
    "127.0.0.1",
    "localhost",
    "::1",
    settings.publicUrl.hostname,
  ]);
  const validateOrigin = originValidation([
    "127.0.0.1",
    "localhost",
    "::1",
    settings.publicUrl.hostname,
    "claude.ai",
    "claude.com",
  ]);

  const httpServer = createServer(async (request, response) => {
    if (!validateHost(request, response) || !validateOrigin(request, response)) {
      return;
    }

    const url = requestUrl(request);
    if (request.method === "GET" && url.pathname === "/health") {
      const body = JSON.stringify({ ok: true });
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-length": Buffer.byteLength(body),
        "content-type": "application/json; charset=utf-8",
      });
      response.end(body);
      return;
    }

    if (
      request.method === "GET" &&
      [
        settings.protectedResourceMetadataUrl.pathname,
        "/.well-known/oauth-protected-resource",
      ].includes(url.pathname)
    ) {
      await writeWebResponse(
        response,
        Response.json(settings.protectedResourceMetadata(), {
          headers: {
            "access-control-allow-origin": "*",
            "cache-control": "public, max-age=3600",
          },
        }),
      );
      return;
    }

    const acceptedMcpPaths = new Set([
      "/mcp",
      settings.publicUrl.pathname,
    ]);
    if (!acceptedMcpPaths.has(url.pathname)) {
      response.writeHead(404);
      response.end();
      return;
    }

    const webRequest = await toWebRequest(request);
    const auth = await requireAuth(webRequest);
    if (auth instanceof Response) {
      await writeWebResponse(response, auth);
      return;
    }
    await writeWebResponse(
      response,
      await handler.fetch(webRequest, { authInfo: auth }),
    );
  });

  return {
    cache,
    handler,
    httpServer,
    async start(port = settings.port) {
      await new Promise<void>((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(port, settings.host, () => {
          httpServer.off("error", reject);
          resolve();
        });
      });
    },
    async close() {
      await handler.close();
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
      cache.close();
    },
  };
}

async function main() {
  if (process.argv.includes("--check-remote")) {
    try {
      DashboardRemoteSettings.fromEnvironment();
      console.log("Remote dashboard MCP configuration is valid.");
    } catch (error) {
      console.error(
        error instanceof Error ? error.message : "Remote configuration failed",
      );
      process.exitCode = 2;
    }
    return;
  }

  if (process.env.DASHBOARD_MCP_PUBLIC_URL?.trim()) {
    let settings: DashboardRemoteSettings;
    try {
      settings = DashboardRemoteSettings.fromEnvironment();
    } catch (error) {
      console.error(
        error instanceof RemoteConfigurationError || error instanceof Error
          ? error.message
          : "Remote dashboard MCP configuration failed",
      );
      process.exitCode = 2;
      return;
    }
    const remoteMcp = createRemoteDashboardMcp({ settings });
    await remoteMcp.start();
    console.log(
      `Authenticated dashboard MCP ready on ${settings.host}:${settings.port}/mcp`,
    );
    const stop = () => {
      void remoteMcp.close().finally(() => {
        process.exitCode = 0;
      });
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    return;
  }

  const port = Number(process.env.DASHBOARD_MCP_PORT ?? DASHBOARD_MCP_PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    console.error("DASHBOARD_MCP_PORT must be a valid local port.");
    process.exitCode = 1;
    return;
  }

  const localMcp = createLocalDashboardMcp();
  await localMcp.start(port);
  console.log(`Local dashboard MCP ready on 127.0.0.1:${port}/mcp`);

  const stop = () => {
    void localMcp.close().finally(() => {
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
