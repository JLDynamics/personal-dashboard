import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export const DEFAULT_REMOTE_MCP_PORT = 8792;
export const DEFAULT_REMOTE_SCOPE = "dashboard-read";

export class RemoteConfigurationError extends Error {}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new RemoteConfigurationError(
      `remote dashboard MCP remains disabled; missing: ${name}`,
    );
  }
  return value;
}

function secureUrl(value: string, name: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RemoteConfigurationError(`${name} must be a valid URL`);
  }
  if (url.protocol !== "https:") {
    throw new RemoteConfigurationError(`${name} must use https`);
  }
  return url;
}

export class DashboardRemoteSettings {
  publicUrl: URL;
  issuerUrl: URL;
  jwksUrl: URL;
  audience: string;
  allowedSubject: string;
  requiredScope: string;
  host: string;
  port: number;

  constructor({
    publicUrl,
    issuerUrl,
    jwksUrl,
    audience,
    allowedSubject,
    requiredScope = DEFAULT_REMOTE_SCOPE,
    host = "127.0.0.1",
    port = DEFAULT_REMOTE_MCP_PORT,
  }: {
    publicUrl: URL | string;
    issuerUrl: URL | string;
    jwksUrl: URL | string;
    audience: string;
    allowedSubject: string;
    requiredScope?: string;
    host?: string;
    port?: number;
  }) {
    this.publicUrl = secureUrl(String(publicUrl), "publicUrl");
    this.issuerUrl = secureUrl(String(issuerUrl), "issuerUrl");
    this.jwksUrl = secureUrl(String(jwksUrl), "jwksUrl");
    this.audience = audience.trim();
    this.allowedSubject = allowedSubject.trim();
    this.requiredScope = requiredScope.trim();
    this.host = host.trim();
    this.port = port;
    this.validate();
  }

  static fromEnvironment() {
    const rawPort =
      process.env.DASHBOARD_MCP_REMOTE_PORT?.trim() ??
      String(DEFAULT_REMOTE_MCP_PORT);
    const port = Number(rawPort);
    return new DashboardRemoteSettings({
      publicUrl: requiredEnvironment("DASHBOARD_MCP_PUBLIC_URL"),
      issuerUrl: requiredEnvironment("DASHBOARD_MCP_ISSUER_URL"),
      jwksUrl: requiredEnvironment("DASHBOARD_MCP_JWKS_URL"),
      audience: requiredEnvironment("DASHBOARD_MCP_AUDIENCE"),
      allowedSubject: requiredEnvironment("DASHBOARD_MCP_ALLOWED_SUBJECT"),
      requiredScope:
        process.env.DASHBOARD_MCP_REQUIRED_SCOPE === undefined
          ? DEFAULT_REMOTE_SCOPE
          : process.env.DASHBOARD_MCP_REQUIRED_SCOPE.trim(),
      host: process.env.DASHBOARD_MCP_REMOTE_HOST?.trim() || "127.0.0.1",
      port,
    });
  }

  validate() {
    if (!this.publicUrl.pathname.endsWith("/mcp")) {
      throw new RemoteConfigurationError("publicUrl must end with /mcp");
    }
    if (!this.audience) {
      throw new RemoteConfigurationError("audience must not be empty");
    }
    if (!this.allowedSubject) {
      throw new RemoteConfigurationError("allowedSubject must not be empty");
    }
    if (!["127.0.0.1", "::1", "localhost"].includes(this.host)) {
      throw new RemoteConfigurationError(
        "remote dashboard MCP must bind to loopback",
      );
    }
    if (!Number.isInteger(this.port) || this.port < 1 || this.port > 65_535) {
      throw new RemoteConfigurationError(
        "DASHBOARD_MCP_REMOTE_PORT must be a valid port",
      );
    }
  }

  get protectedResourceMetadataUrl() {
    const path = this.publicUrl.pathname.replace(/^\/+/, "");
    return new URL(
      `/.well-known/oauth-protected-resource/${path}`,
      this.publicUrl,
    );
  }

  protectedResourceMetadata() {
    return {
      resource: this.publicUrl.href,
      authorization_servers: [this.issuerUrl.href],
      ...(this.requiredScope
        ? { scopes_supported: [this.requiredScope] }
        : {}),
      bearer_methods_supported: ["header"],
      resource_name: "Personal Dashboard",
    };
  }
}

function tokenScopes(payload: JWTPayload) {
  const value = payload.scope ?? payload.scp;
  if (typeof value === "string") {
    return value.split(/\s+/).filter(Boolean);
  }
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value;
  }
  return [];
}

export class Auth0JwtVerifier implements OAuthTokenVerifier {
  settings: DashboardRemoteSettings;
  jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(settings: DashboardRemoteSettings) {
    this.settings = settings;
    this.jwks = createRemoteJWKSet(settings.jwksUrl);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.settings.issuerUrl.href,
        audience: this.settings.audience,
        algorithms: ["RS256", "ES256"],
      });
      const subject = String(payload.sub ?? "");
      const email = String(payload.email ?? "");
      if (!this.settings.allowedSubject.includes("@")) {
        if (subject !== this.settings.allowedSubject) {
          throw new OAuthError(
            OAuthErrorCode.InvalidToken,
            "Access token belongs to another user",
          );
        }
      } else if (email !== this.settings.allowedSubject) {
        throw new OAuthError(
          OAuthErrorCode.InvalidToken,
          "Access token belongs to another user",
        );
      }

      const scopes = tokenScopes(payload);
      if (
        this.settings.requiredScope &&
        !scopes.includes(this.settings.requiredScope)
      ) {
        console.warn("[dashboard-mcp] insufficient scope details:", {
          audience: payload.aud,
          clientId: String(payload.azp ?? payload.client_id ?? ""),
          scopes,
          subject,
        });
        throw new OAuthError(
          OAuthErrorCode.InsufficientScope,
          "Access token is missing the dashboard scope",
        );
      }
      if (typeof payload.exp !== "number") {
        throw new OAuthError(
          OAuthErrorCode.InvalidToken,
          "Access token has no expiration",
        );
      }

      return {
        token,
        clientId: String(payload.azp ?? payload.client_id ?? ""),
        scopes,
        expiresAt: payload.exp,
        resource: new URL(this.settings.audience),
        extra: { subject },
      };
    } catch (error) {
      console.warn(
        "[dashboard-mcp] access token rejected:",
        error instanceof Error ? error.message : "invalid token",
      );
      if (error instanceof OAuthError) throw error;
      throw new OAuthError(
        OAuthErrorCode.InvalidToken,
        "Access token is invalid",
      );
    }
  }
}
