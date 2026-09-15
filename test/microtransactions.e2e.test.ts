import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { GlitchClient } from "../src/glitchClient.js";
import { createGlitchMcpServer } from "../src/server.js";
import { safeTool } from "../src/result.js";
import { glitchToolDefinitions } from "../src/tools.js";
import { MICROTRANSACTION_SETUP_GUIDE } from "../src/microtransactionTools.js";
import { GLITCH_SERVER_INSTRUCTIONS } from "../src/instructions.js";
import { MICROTRANSACTION_CALLBACK_TUTORIAL } from "../src/microtransactionTutorial.js";
import { createFetchMock, expectAuthorization, jsonResponse } from "./helpers.js";

const config = { apiBaseUrl: "https://mcp.example.test", dashboardBaseUrl: "https://app.example.test", timeoutMs: 1000, clientName: "test-client", defaultTitleId: "title-1", token: "test-config-token" };
const product = { sku: "blue-cape", name: "Blue cape", description: "Permanent cosmetic", type: "durable", prices: [{ currency: "USD", country: "*", amount_minor: 499 }], grants: [{ key: "cosmetic.blue_cape", kind: "durable", quantity: 1 }], media_ids: ["10000000-0000-4000-8000-000000000001"] };

describe("microtransactions over the actual MCP protocol", () => {
  let client: Client;
  let server: ReturnType<typeof createGlitchMcpServer>;
  afterEach(async () => { await client?.close(); await server?.close(); });

  async function connect(fetch: ReturnType<typeof createFetchMock>["fetch"]) {
    const glitch = new GlitchClient(config, fetch, undefined, { authToken: "test-caller-token" });
    server = createGlitchMcpServer({ config, client: glitch });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "commerce-client", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  }

  it("discovers complete schemas, scopes and approval guidance through tools, resources and prompts", async () => {
    const catalog = { schema_version: "1.0", title_id: "title-1", operations: [{ operation: "products.create", ability: "commerce:write", requires_confirmation: true, requires_human_approval: true, input_schema: { type: "object", properties: { amount_minor: { type: "integer", description: "currency minor units" } } }, examples: [{ sku: "blue-cape" }], output_description: "Product with immutable version" }] };
    const mock = createFetchMock(() => jsonResponse({ data: catalog }));
    await connect(mock.fetch);
    const tools = await client.listTools();
    const create = tools.tools.find(tool => tool.name === "glitch_create_microtransaction_product")!;
    expect(create.inputSchema.properties?.prices).toBeDefined();
    expect(create.inputSchema.properties?.grants).toBeDefined();
    expect(create.inputSchema.properties?.media_ids).toBeDefined();
    expect(JSON.stringify(create.inputSchema)).toContain("integer minor units");
    expect(create.annotations?.readOnlyHint).toBe(false);
    expect(tools.tools.find(tool => tool.name === "glitch_get_microtransaction_readiness")?.annotations?.readOnlyHint).toBe(true);
    const result = await client.callTool({ name: "glitch_get_microtransaction_capabilities", arguments: {} });
    expect(result.structuredContent?.data).toEqual(catalog);
    expect(JSON.stringify(result.content)).toContain("requires_human_approval");
    expectAuthorization(mock.requests[0]?.init, "test-caller-token");
    expect(mock.requests[0]?.url).toBe("https://mcp.example.test/mcp/v1/titles/title-1/microtransactions/capabilities");
    const resource = await client.readResource({ uri: "glitch://titles/title-1/microtransactions/capabilities" });
    expect(JSON.stringify(resource.contents)).toContain("requires_human_approval");
    const guide = await client.readResource({ uri: "glitch://microtransactions/setup" });
    expect(JSON.stringify(guide.contents)).toContain("1200bp");
    const prompt = await client.getPrompt({ name: "glitch_setup_microtransactions", arguments: { title_id: "title-1" } });
    expect(JSON.stringify(prompt)).toContain("claimHandoff");
    expect(mock.requests).toHaveLength(2);
  });

  it("forwards exact nested catalog payload, defaults to draft, and preserves minor units", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: { operation: "products.create", result: { id: "10000000-0000-4000-8000-000000000002", version: 1, status: "draft" } } }));
    await connect(mock.fetch);
    const result = await client.callTool({ name: "glitch_create_microtransaction_product", arguments: { ...product, confirm: true } });
    expect(result.isError).toBeUndefined();
    expect(mock.requests[0]?.url).toBe("https://mcp.example.test/mcp/v1/titles/title-1/microtransactions/operations/products.create");
    expect(mock.requests[0]?.body).toEqual({ arguments: { ...product, status: "draft", localizations: {}, max_per_order: 1 }, confirm: true });
    expectAuthorization(mock.requests[0]?.init, "test-caller-token");
  });

  it("serves a complete beginner callback and separates self-player history from developer MCP access", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: {} }));
    await connect(mock.fetch);
    const resource = await client.readResource({ uri: "glitch://microtransactions/setup" });
    const prompt = await client.getPrompt({ name: "glitch_setup_microtransactions", arguments: { title_id: "title-1" } });
    for (const content of [JSON.stringify(resource.contents), JSON.stringify(prompt.messages)]) {
      expect(content).toContain("export function installTimberShop");
      expect(content).toContain("Minimum SDK for this tutorial is 3.15.0");
      expect(content).toContain("approved local package");
      expect(content).toContain("public latest 3.10.8, which lacks commerce");
      expect(content).toContain("game.playerId = result.player_id");
      expect(content).toContain("playerToken = result.player_token");
      expect(content).toContain("replaceInventoryInYourGame(result.entitlements)");
      expect(content).toContain("pendingUse ??=");
      expect(content).toContain("page, per_page: 20");
      expect(content).toContain("purchased_quantity");
      expect(content).toContain("granted_quantity");
      expect(content).toContain("unrecoverable overlaps consumed");
      expect(content).toContain("Durable/pass is_used is null");
    }
    expect(MICROTRANSACTION_CALLBACK_TUTORIAL).toContain("rejects MCP/install tokens and caller user_id/player_id");
    expect(MICROTRANSACTION_CALLBACK_TUTORIAL).toContain("Pricing/monetization");
    expect(MICROTRANSACTION_CALLBACK_TUTORIAL).toContain("Timber as durable");
    expect(MICROTRANSACTION_CALLBACK_TUTORIAL).toContain("no_purchases_to_restore");
    expect(MICROTRANSACTION_CALLBACK_TUTORIAL).toContain("do not promise universal token renewal");
    expect(glitchToolDefinitions.some(tool => tool.name === "glitch_list_my_purchases")).toBe(false);
    expect(mock.requests).toHaveLength(0);
  });

  it("publishes bounded UI-only ready/watchdog guidance without substituting it for browser 3DS proof", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: {} }));
    await connect(mock.fetch);
    const resource = await client.readResource({ uri: "glitch://microtransactions/setup" });
    const prompt = await client.getPrompt({ name: "glitch_setup_microtransactions", arguments: { title_id: "title-1" } });
    for (const text of [JSON.stringify(resource.contents), JSON.stringify(prompt.messages), GLITCH_SERVER_INSTRUCTIONS]) {
      expect(text).toContain("glitch.microtransaction.ready");
      expect(text).toContain("frameLoadTimeoutMs");
      expect(text).toContain("20 seconds");
      expect(text).toContain("Retry/Close");
      expect(text).toContain("checkout_session_id");
      expect(text).toContain("nonce");
      expect(text).toContain("provider-frame usability");
    }
    expect(MICROTRANSACTION_SETUP_GUIDE).toContain("iframe load event is document-loaded only, not application-ready");
    expect(MICROTRANSACTION_SETUP_GUIDE).toContain("Retry reloads the same session");
    expect(MICROTRANSACTION_SETUP_GUIDE).toContain("verified ready/claim and close clear the timers");
    expect(MICROTRANSACTION_SETUP_GUIDE).toContain("direct API capture test cannot replace browser 3DS evidence");
    expect(MICROTRANSACTION_SETUP_GUIDE).toContain("verification pending until actually observed");
    expect(mock.requests).toHaveLength(0);
  });

  it("rejects unconfirmed mutations, fractional money, credentials and malformed title IDs without an HTTP request", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: {} }));
    await connect(mock.fetch);
    const inputs = [
      { ...product },
      { ...product, confirm: true, prices: [{ currency: "USD", country: "*", amount_minor: 4.99 }] },
      { ...product, confirm: true, provider_secret: "test-should-never-forward" },
      { ...product, confirm: true, title_id: "../other-title" }
    ];
    for (const args of inputs) {
      const result = await client.callTool({ name: "glitch_create_microtransaction_product", arguments: args });
      expect(result.isError).toBe(true);
    }
    expect(mock.requests).toHaveLength(0);
  });

  it("preserves cross-title denial and never falls back to a runtime or configured operator token", async () => {
    const mock = createFetchMock(() => jsonResponse({ message: "This credential cannot access the requested title." }, 403));
    await connect(mock.fetch);
    const result = await client.callTool({ name: "glitch_get_microtransaction_order", arguments: { title_id: "other-title", order_id: "10000000-0000-4000-8000-000000000004" } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent?.code).toBe("permission_denied");
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0]?.url).toContain("/other-title/microtransactions/");
    expectAuthorization(mock.requests[0]?.init, "test-caller-token");
  });

  it("confirm does not bypass the server's financial human-approval gate", async () => {
    const mock = createFetchMock(() => jsonResponse({ message: "Financial administrator must review and execute in Glitch.", code: "human_approval_required" }, 409));
    await connect(mock.fetch);
    const result = await client.callTool({ name: "glitch_request_microtransaction_refund", arguments: { order_id: "10000000-0000-4000-8000-000000000003", reason: "Player requested review", confirm: true } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent?.code).toBe("human_approval_required");
    expect(JSON.stringify(result.content)).toContain("human_approval_required");
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0]?.body).toEqual({ arguments: { order_id: "10000000-0000-4000-8000-000000000003", reason: "Player requested review" }, confirm: true });
  });

  it("partial settings/product updates never fill omitted fields with destructive defaults", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: { operation: "products.update", result: { id: "10000000-0000-4000-8000-000000000002" } } }));
    await connect(mock.fetch);
    await client.callTool({ name: "glitch_update_microtransaction_product", arguments: { product_id: "10000000-0000-4000-8000-000000000002", name: "Renamed cape", confirm: true } });
    expect(mock.requests[0]?.body).toEqual({ arguments: { product_id: "10000000-0000-4000-8000-000000000002", name: "Renamed cape" }, confirm: true });
    await client.callTool({ name: "glitch_update_microtransaction_settings", arguments: { branding: { accent_color: "#4455ff" }, confirm: true } });
    expect(mock.requests[1]?.body).toEqual({ arguments: { branding: { accent_color: "#4455ff" } }, confirm: true });
  });

  it("uses the authorized Media pipeline with no scheduler/post fields and no local reads over HTTP", async () => {
    const mock = createFetchMock(request => {
      const form = request.init?.body as FormData;
      expect(form.has("media")).toBe(true);
      expect([...form.keys()]).toEqual(["media"]);
      return jsonResponse({ data: { id: "media-1", url: "https://cdn.example.test/image.png", mime_type: "image/png", poster: null } });
    });
    await connect(mock.fetch);
    const local = await client.callTool({ name: "glitch_upload_microtransaction_media", arguments: { file_path: "/not-readable.png", confirm: true } });
    expect(local.isError).toBe(true);
    expect(mock.requests).toHaveLength(0);
    const result = await client.callTool({ name: "glitch_upload_microtransaction_media", arguments: { content_base64: Buffer.from("test-image").toString("base64"), file_name: "cape.png", confirm: true } });
    expect(result.isError).toBeUndefined();
    expect(mock.requests[0]?.url).toBe("https://mcp.example.test/mcp/v1/titles/title-1/microtransactions/media");
    expectAuthorization(mock.requests[0]?.init, "test-caller-token");
  });

  it("denies SVG and document uploads and redacts accidental upstream credential fields", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: { operation: "providers.list", result: { providers: [{ provider: "stripe", api_key: "test-secret-not-for-output" }] } } }));
    await connect(mock.fetch);
    const denied = await client.callTool({ name: "glitch_upload_microtransaction_media", arguments: { content_base64: Buffer.from("<svg/>").toString("base64"), file_name: "cape.svg", mime_type: "image/svg+xml", confirm: true } });
    expect(denied.isError).toBe(true);
    expect(mock.requests).toHaveLength(0);
    const result = await client.callTool({ name: "glitch_list_microtransaction_providers", arguments: {} });
    expect(JSON.stringify(result)).not.toContain("test-secret-not-for-output");
    expect(JSON.stringify(result)).toContain("[redacted]");
  });

  it("replays immutable delivery ID and asks only least-privilege scopes", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: { operation: "deliveries.replay", result: { event_id: "event-1", status: "pending" } } }));
    await connect(mock.fetch);
    const result = await client.callTool({ name: "glitch_replay_microtransaction_delivery", arguments: { delivery_id: "10000000-0000-4000-8000-000000000005", confirm: true } });
    expect(result.isError).toBeUndefined();
    expect(mock.requests[0]?.body).toEqual({ arguments: { delivery_id: "10000000-0000-4000-8000-000000000005" }, confirm: true });
    expect(MICROTRANSACTION_SETUP_GUIDE).toContain("No wildcard is implied");
    expect(MICROTRANSACTION_SETUP_GUIDE).toContain("payment_status, fulfillment_status");
  });
});

describe("commerce capability schemas independently of protocol defaults", () => {
  it("validates every sensitive tool's confirmation before transport", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: {} }));
    const client = new GlitchClient(config, mock.fetch);
    for (const [name, args] of [
      ["glitch_archive_microtransaction_product", { product_id: "10000000-0000-4000-8000-000000000002" }],
      ["glitch_update_microtransaction_settings", { environment: "live" }],
      ["glitch_request_microtransaction_refund", { order_id: "10000000-0000-4000-8000-000000000003", reason: "Review refund" }],
      ["glitch_replay_microtransaction_delivery", { delivery_id: "10000000-0000-4000-8000-000000000005" }]
    ] as const) {
      const tool = glitchToolDefinitions.find(tool => tool.name === name)!;
      const result = await safeTool(() => tool.handler(client, args));
      expect(result.isError).toBe(true);
      expect(result.structuredContent?.code).toBe("confirmation_required");
    }
    expect(mock.requests).toHaveLength(0);
  });
});
