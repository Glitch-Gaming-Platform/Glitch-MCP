import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { GlitchClient } from "../src/glitchClient.js";
import { createGlitchMcpServer } from "../src/server.js";
import { createFetchMock, expectAuthorization, jsonResponse } from "./helpers.js";

const config = {
  apiBaseUrl: "https://mcp.example.test",
  dashboardBaseUrl: "https://app.example.test",
  timeoutMs: 1000,
  clientName: "monetization-test-client",
  defaultTitleId: "title-1",
  token: "config-token",
};

describe("premium-only monetization through the actual MCP protocol", () => {
  let client: Client;
  let server: ReturnType<typeof createGlitchMcpServer>;

  afterEach(async () => {
    await client?.close();
    await server?.close();
  });

  async function connect(fetch: ReturnType<typeof createFetchMock>["fetch"]) {
    const glitch = new GlitchClient(config, fetch, undefined, { authToken: "caller-token" });
    server = createGlitchMcpServer({ config, client: glitch });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "monetization-test", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  }

  it("lists read and write tools with explicit confirmation and concurrency requirements", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: {} }));
    await connect(mock.fetch);
    const tools = await client.listTools();
    const read = tools.tools.find((tool) => tool.name === "glitch_get_game_monetization");
    const update = tools.tools.find((tool) => tool.name === "glitch_update_game_monetization");
    expect(read?.annotations?.readOnlyHint).toBe(true);
    expect(update?.annotations?.readOnlyHint).toBe(false);
    expect(update?.inputSchema.properties?.expected_version).toBeDefined();
    expect(update?.inputSchema.properties?.premium_purchase_required_for_full_game).toBeDefined();
    expect(update?.inputSchema.required).toContain("confirm");
    expect(update?.inputSchema.required).toContain("expected_version");
    expect(mock.requests).toHaveLength(0);
  });

  it("reads canonical pricing and forwards a confirmed versioned settings update", async () => {
    const version = "c".repeat(64);
    const mock = createFetchMock((request) => jsonResponse({
      data: request.url.endsWith("/monetization")
        ? { title_id: "title-1", version, is_premium: true, premium_purchase_required_for_full_game: true }
        : {},
    }));
    await connect(mock.fetch);
    const read = await client.callTool({ name: "glitch_get_game_monetization", arguments: {} });
    expect(read.isError).toBeUndefined();
    expect(read.structuredContent?.data).toMatchObject({
      version, premium_purchase_required_for_full_game: true,
    });
    const update = await client.callTool({
      name: "glitch_update_game_monetization",
      arguments: {
        expected_version: version,
        confirm: true,
        is_premium: true,
        is_rental: false,
        is_subscription_eligible: true,
        premium_price: 14.99,
        premium_purchase_required_for_full_game: true,
      },
    });
    expect(update.isError).toBeUndefined();
    expect(mock.requests).toHaveLength(2);
    expect(mock.requests[0]?.url).toBe("https://mcp.example.test/mcp/v1/titles/title-1/monetization");
    expect(mock.requests[1]?.url).toBe("https://mcp.example.test/mcp/v1/titles/title-1/monetization");
    expect(mock.requests[1]?.body).toEqual({
      expected_version: version,
      confirm: true,
      is_premium: true,
      is_rental: false,
      is_subscription_eligible: true,
      premium_price: 14.99,
      premium_purchase_required_for_full_game: true,
    });
    for (const request of mock.requests) {
      expectAuthorization(request.init, "caller-token");
    }
    expect(mock.requests[1]?.init?.method).toBe("PUT");
  });

  it("never sends a mutation when the caller omits confirmation or an expected version", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: {} }));
    await connect(mock.fetch);
    for (const args of [
      { expected_version: "a".repeat(64), premium_purchase_required_for_full_game: true },
      { confirm: true, premium_purchase_required_for_full_game: true },
    ]) {
      const result = await client.callTool({
        name: "glitch_update_game_monetization",
        arguments: args,
      });
      expect(result.isError).toBe(true);
    }
    expect(mock.requests).toHaveLength(0);
  });

  it("preserves detailed license metadata from install validation without exposing provider data", async () => {
    const mock = createFetchMock(() => jsonResponse({
      valid: true,
      license_type: "purchased",
      license: {
        type: "premium", status: "active", acquired_at: "2026-11-05T12:00:00Z",
        price_paid: { amount: "14.99", currency: "USD" },
      },
      access: { premium_purchase_required: true, subscription_alone_sufficient: false },
    }));
    await connect(mock.fetch);
    const result = await client.callTool({
      name: "glitch_validate_install",
      arguments: { install_id: "install-verified" },
    });
    expect(result.isError).toBeUndefined();
    expect(JSON.stringify(result.structuredContent)).toContain('"premium"');
    expect(JSON.stringify(result.structuredContent)).toContain('"14.99"');
    expect(mock.requests[0]?.url)
      .toBe("https://mcp.example.test/titles/title-1/installs/install-verified/validate");
  });
});
