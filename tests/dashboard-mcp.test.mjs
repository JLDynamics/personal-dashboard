import assert from "node:assert/strict";
import test from "node:test";

import {
  ASK_DASHBOARD_TOOL,
  buildDashboardMcpServer,
  createRemoteDashboardMcp,
} from "../scripts/dashboard-mcp.ts";
import { DashboardRemoteSettings } from "../scripts/dashboard-remote-auth.ts";
import { sampleData } from "../app/data/sample-data.ts";

test("dashboard MCP exposes one read-only cached-data tool", () => {
  const cache = {
    readSnapshot: () => structuredClone(sampleData),
  };
  const server = buildDashboardMcpServer({
    cache,
    answer: async () => ({
      answer: "Cached answer",
      asOf: sampleData.savedAt,
      usedSections: ["weather"],
      sources: [],
    }),
  });

  const tools = server._registeredTools;
  assert.deepEqual(Object.keys(tools), [ASK_DASHBOARD_TOOL]);
  assert.equal(tools[ASK_DASHBOARD_TOOL].annotations.readOnlyHint, true);
  assert.equal(tools[ASK_DASHBOARD_TOOL].annotations.destructiveHint, false);
  assert.equal(tools[ASK_DASHBOARD_TOOL].annotations.openWorldHint, false);
});

test("remote MCP advertises OAuth and rejects unauthenticated requests", async () => {
  const settings = new DashboardRemoteSettings({
    publicUrl: "https://dashboard.example.com/dashboard/mcp",
    issuerUrl: "https://auth.example.com/",
    jwksUrl: "https://auth.example.com/.well-known/jwks.json",
    audience: "https://dashboard.example.com/dashboard/mcp",
    allowedSubject: "jack",
  });
  const cache = {
    readSnapshot: () => structuredClone(sampleData),
    close: () => {},
  };
  const remote = createRemoteDashboardMcp({
    settings,
    cache,
    verifier: {
      verifyAccessToken: async (token) => ({
        token,
        clientId: "claude",
        scopes: ["dashboard-read"],
        expiresAt: Math.floor(Date.now() / 1_000) + 600,
        resource: settings.publicUrl,
      }),
    },
  });

  await remote.start(0);
  const address = remote.httpServer.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const metadata = await fetch(
      `${baseUrl}/.well-known/oauth-protected-resource/dashboard/mcp`,
    );
    assert.equal(metadata.status, 200);
    assert.equal((await metadata.json()).resource, settings.publicUrl.href);

    const internalProxyPath = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "mcp-method": "tools/list",
        "mcp-protocol-version": "2026-07-28",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 0,
        method: "tools/list",
        params: {},
      }),
    });
    assert.equal(internalProxyPath.status, 401);

    const rejected = await fetch(`${baseUrl}/dashboard/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "mcp-method": "tools/list",
        "mcp-protocol-version": "2026-07-28",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    });
    assert.equal(rejected.status, 401);
    assert.match(
      rejected.headers.get("www-authenticate"),
      /oauth-protected-resource\/dashboard\/mcp/,
    );

    const accepted = await fetch(`${baseUrl}/dashboard/mcp`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        authorization: "Bearer valid-token",
        "content-type": "application/json",
        "mcp-method": "tools/list",
        "mcp-protocol-version": "2026-07-28",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientInfo": {
              name: "dashboard-test",
              version: "1.0.0",
            },
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
    });
    assert.equal(accepted.status, 200);
    const payload = await accepted.json();
    assert.deepEqual(
      payload.result.tools.map((tool) => tool.name),
      [ASK_DASHBOARD_TOOL],
    );
  } finally {
    await remote.close();
  }
});
