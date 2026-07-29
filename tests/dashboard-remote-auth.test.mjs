import assert from "node:assert/strict";
import test from "node:test";

import { generateKeyPair, SignJWT } from "jose";

import {
  Auth0JwtVerifier,
  DashboardRemoteSettings,
  RemoteConfigurationError,
} from "../scripts/dashboard-remote-auth.ts";

function settings(overrides = {}) {
  return new DashboardRemoteSettings({
    publicUrl: "https://dashboard.example.com/mcp",
    issuerUrl: "https://auth.example.com/",
    jwksUrl: "https://auth.example.com/.well-known/jwks.json",
    audience: "https://dashboard.example.com/mcp",
    allowedSubject: "jack",
    ...overrides,
  });
}

test("remote configuration requires HTTPS, an MCP path, and loopback", () => {
  assert.throws(
    () => settings({ publicUrl: "http://dashboard.example.com/mcp" }),
    RemoteConfigurationError,
  );
  assert.throws(
    () => settings({ publicUrl: "https://dashboard.example.com/api" }),
    /must end with \/mcp/,
  );
  assert.throws(
    () => settings({ host: "0.0.0.0" }),
    /must bind to loopback/,
  );
});

test("remote metadata advertises one separate read-only dashboard scope", () => {
  const configured = settings({
    publicUrl: "https://dashboard.example.com/dashboard/mcp",
    audience: "https://dashboard.example.com/dashboard/mcp",
  });

  assert.equal(
    configured.protectedResourceMetadataUrl.href,
    "https://dashboard.example.com/.well-known/oauth-protected-resource/dashboard/mcp",
  );
  assert.deepEqual(configured.protectedResourceMetadata(), {
    resource: "https://dashboard.example.com/dashboard/mcp",
    authorization_servers: ["https://auth.example.com/"],
    scopes_supported: ["dashboard-read"],
    bearer_methods_supported: ["header"],
    resource_name: "Personal Dashboard",
  });
});

test("remote metadata can omit a custom scope for an audience-bound read-only connector", () => {
  const configured = settings({ requiredScope: "" });

  assert.deepEqual(configured.protectedResourceMetadata(), {
    resource: "https://dashboard.example.com/mcp",
    authorization_servers: ["https://auth.example.com/"],
    bearer_methods_supported: ["header"],
    resource_name: "Personal Dashboard",
  });
});

test("Auth0 verifier accepts only the configured user, audience, and scope", async () => {
  const configured = settings();
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const verifier = new Auth0JwtVerifier(configured);
  verifier.jwks = async () => publicKey;

  const valid = await new SignJWT({ scope: "openid dashboard-read" })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(configured.issuerUrl.href)
    .setAudience(configured.audience)
    .setSubject("jack")
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(privateKey);
  const auth = await verifier.verifyAccessToken(valid);

  assert.equal(auth.extra.subject, "jack");
  assert.deepEqual(auth.scopes, ["openid", "dashboard-read"]);

  const otherUser = await new SignJWT({ scope: "dashboard-read" })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(configured.issuerUrl.href)
    .setAudience(configured.audience)
    .setSubject("someone-else")
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(privateKey);
  await assert.rejects(
    verifier.verifyAccessToken(otherUser),
    /another user/,
  );
});

test("Auth0 verifier can rely on exact issuer, audience, and user without a custom scope", async () => {
  const configured = settings({ requiredScope: "" });
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const verifier = new Auth0JwtVerifier(configured);
  verifier.jwks = async () => publicKey;

  const valid = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(configured.issuerUrl.href)
    .setAudience(configured.audience)
    .setSubject("jack")
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(privateKey);

  const auth = await verifier.verifyAccessToken(valid);
  assert.equal(auth.extra.subject, "jack");
  assert.deepEqual(auth.scopes, []);
});
