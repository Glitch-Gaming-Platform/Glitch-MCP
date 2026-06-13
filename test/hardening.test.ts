import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { protectedResourceMetadata, wwwAuthenticateHeader } from "../src/oauth.js";
import { createFixedWindowRateLimiter } from "../src/rateLimit.js";

describe("optional OAuth metadata", () => {
  it("is disabled by default and parses opt-in OAuth config", () => {
    expect(loadConfig({}).oauthEnabled).toBe(false);

    const config = loadConfig({
      GLITCH_MCP_OAUTH_ENABLED: "true",
      GLITCH_MCP_OAUTH_ISSUER: "https://auth.glitch.fun",
      GLITCH_MCP_OAUTH_RESOURCE_URL: "https://mcp.glitch.fun/mcp",
      GLITCH_MCP_OAUTH_SCOPES: "runs:read, runs:create"
    });

    expect(config.oauthEnabled).toBe(true);
    expect(config.oauthScopes).toEqual(["runs:read", "runs:create"]);

    const meta = protectedResourceMetadata(config, "http://127.0.0.1:3333/mcp");
    expect(meta.resource).toBe("https://mcp.glitch.fun/mcp");
    expect(meta.authorization_servers).toEqual(["https://auth.glitch.fun"]);
    expect(meta.bearer_methods_supported).toEqual(["header"]);
    expect(meta.scopes_supported).toEqual(["runs:read", "runs:create"]);
  });

  it("builds a WWW-Authenticate challenge that points at the metadata document", () => {
    expect(wwwAuthenticateHeader("https://mcp.glitch.fun/.well-known/oauth-protected-resource")).toBe(
      'Bearer resource_metadata="https://mcp.glitch.fun/.well-known/oauth-protected-resource"'
    );
  });
});

describe("config hardening flags", () => {
  it("parses allowed hosts and rate limit", () => {
    const config = loadConfig({
      GLITCH_MCP_ALLOWED_HOSTS: "mcp.glitch.fun, localhost",
      GLITCH_MCP_RATE_LIMIT_PER_MINUTE: "30",
      GLITCH_MCP_UPLOAD_ALLOWED_ROOTS: "/work/game,/tmp/assets"
    });
    expect(config.allowedHosts).toEqual(["mcp.glitch.fun", "localhost"]);
    expect(config.rateLimitPerMinute).toBe(30);
    expect(config.uploadAllowedRoots).toEqual(["/work/game", "/tmp/assets"]);
  });

  it("treats local file reads as tri-state", () => {
    expect(loadConfig({}).allowLocalFileReads).toBeUndefined();
    expect(loadConfig({ GLITCH_MCP_ALLOW_LOCAL_FILE_READS: "false" }).allowLocalFileReads).toBe(false);
    expect(loadConfig({ GLITCH_MCP_ALLOW_LOCAL_FILE_READS: "true" }).allowLocalFileReads).toBe(true);
  });
});

describe("fixed-window rate limiter", () => {
  it("allows up to the limit per window, then blocks with a retry hint", () => {
    let now = 1_000_000;
    const limiter = createFixedWindowRateLimiter(2, () => now);

    expect(limiter.check("k").allowed).toBe(true);
    expect(limiter.check("k").allowed).toBe(true);
    const blocked = limiter.check("k");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);

    // A different key has its own budget.
    expect(limiter.check("other").allowed).toBe(true);

    // After the window elapses, the budget resets.
    now += 60_001;
    expect(limiter.check("k").allowed).toBe(true);
  });

  it("is disabled when the limit is zero", () => {
    const limiter = createFixedWindowRateLimiter(0);
    for (let i = 0; i < 100; i += 1) {
      expect(limiter.check("k").allowed).toBe(true);
    }
  });
});
