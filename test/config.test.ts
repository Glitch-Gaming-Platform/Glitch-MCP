import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { GlitchMcpError } from "../src/errors.js";

describe("loadConfig", () => {
  it("loads defaults for the public hosted service", () => {
    const config = loadConfig({});

    expect(config.apiBaseUrl).toBe("https://api.glitch.fun/api");
    expect(config.dashboardBaseUrl).toBe("https://app.glitch.fun");
    expect(config.timeoutMs).toBe(30_000);
    expect(config.clientName).toBe("glitch-mcp");
    expect(config.token).toBeUndefined();
  });

  it("normalizes configured URLs and optional token/title values", () => {
    const config = loadConfig({
      GLITCH_API_BASE_URL: "https://example.test/api/",
      GLITCH_DASHBOARD_URL: "https://app.example.test/",
      GLITCH_API_TOKEN: " title-token ",
      GLITCH_TITLE_ID: "title_123",
      GLITCH_MCP_TIMEOUT_MS: "9000",
      GLITCH_MCP_CLIENT_NAME: "cursor"
    });

    expect(config.apiBaseUrl).toBe("https://example.test/api");
    expect(config.dashboardBaseUrl).toBe("https://app.example.test");
    expect(config.token).toBe("title-token");
    expect(config.defaultTitleId).toBe("title_123");
    expect(config.timeoutMs).toBe(9000);
    expect(config.clientName).toBe("cursor");
  });

  it("still supports legacy GLITCH_MCP_* aliases", () => {
    const config = loadConfig({
      GLITCH_MCP_URL: "https://legacy.example.test/mcp/",
      GLITCH_MCP_TOKEN: " legacy-token ",
      GLITCH_MCP_DEFAULT_TITLE_ID: "title_legacy"
    });

    expect(config.apiBaseUrl).toBe("https://legacy.example.test/mcp");
    expect(config.token).toBe("legacy-token");
    expect(config.defaultTitleId).toBe("title_legacy");
  });

  it("rejects invalid URLs", () => {
    expect(() => loadConfig({ GLITCH_MCP_URL: "notaurl" })).toThrow(GlitchMcpError);
  });

  it("rejects invalid timeouts", () => {
    expect(() => loadConfig({ GLITCH_MCP_TIMEOUT_MS: "0" })).toThrow("GLITCH_MCP_TIMEOUT_MS must be a positive integer");
  });
});
