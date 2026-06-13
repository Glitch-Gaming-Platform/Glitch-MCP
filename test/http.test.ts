import { describe, expect, it } from "vitest";
import { GlitchMcpError } from "../src/errors.js";
import { GlitchHttpClient } from "../src/http.js";
import { createFetchMock, expectAuthorization, jsonResponse } from "./helpers.js";

const baseConfig = {
  apiBaseUrl: "https://mcp.example.test",
  dashboardBaseUrl: "https://app.example.test",
  timeoutMs: 1000,
  clientName: "test-client",
  token: "secret-token"
};

describe("GlitchHttpClient", () => {
  it("adds bearer auth, MCP headers, query params, and unwraps data envelopes", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: { ok: true } }));
    const client = new GlitchHttpClient(baseConfig, mock.fetch);

    const result = await client.get("/mcp/v1/titles", { include_archived: false, tags: ["a", "b"] });

    expect(result).toEqual({ ok: true });
    expect(mock.requests[0]?.url).toBe("https://mcp.example.test/mcp/v1/titles?include_archived=false&tags=a&tags=b");
    expectAuthorization(mock.requests[0]?.init, "secret-token");
    expect(new Headers(mock.requests[0]?.init?.headers).get("x-glitch-mcp-client")).toBe("test-client");
  });

  it("preserves base URL path prefixes such as /api", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: { ok: true } }));
    const client = new GlitchHttpClient({
      ...baseConfig,
      apiBaseUrl: "https://api.example.test/api"
    }, mock.fetch);

    await client.get("/mcp/v1/auth/status");

    expect(mock.requests[0]?.url).toBe("https://api.example.test/api/mcp/v1/auth/status");
  });

  it("sends JSON bodies for POST requests", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: { id: "run_1" } }));
    const client = new GlitchHttpClient(baseConfig, mock.fetch);

    await client.post("/mcp/v1/titles/title_1/runs", { initial_message: "Plan launch" });

    expect(mock.requests[0]?.body).toEqual({ initial_message: "Plan launch" });
    expect(new Headers(mock.requests[0]?.init?.headers).get("content-type")).toBe("application/json");
  });

  it("maps subscription failures to a sanitized typed error", async () => {
    const mock = createFetchMock(() =>
      jsonResponse(
        {
          message: "Subscription required.",
          billing_url: "https://app.example.test/billing"
        },
        402
      )
    );
    const client = new GlitchHttpClient(baseConfig, mock.fetch);

    await expect(client.get("/mcp/v1/titles/title_1/context")).rejects.toMatchObject({
      code: "subscription_required",
      message: "Subscription required.",
      details: {
        status: 402,
        billingUrl: "https://app.example.test/billing"
      }
    });
  });

  it("maps validation field errors", async () => {
    const mock = createFetchMock(() =>
      jsonResponse(
        {
          message: "Invalid request.",
          errors: { title_id: ["This title is not available."] }
        },
        422
      )
    );
    const client = new GlitchHttpClient(baseConfig, mock.fetch);

    await expect(client.get("/mcp/v1/titles/bad/context")).rejects.toMatchObject({
      code: "validation_error",
      details: {
        fieldErrors: { title_id: ["This title is not available."] }
      }
    });
  });

  it("maps network failures without leaking token values", async () => {
    const mock = createFetchMock(() => {
      throw new Error("connect ECONNREFUSED secret-token");
    });
    const client = new GlitchHttpClient(baseConfig, mock.fetch);

    try {
      await client.get("/mcp/v1/auth/status");
      throw new Error("Expected request to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(GlitchMcpError);
      expect(String((error as Error).message)).not.toContain("secret-token");
      expect(error).toMatchObject({ code: "upstream_error" });
    }
  });
});
