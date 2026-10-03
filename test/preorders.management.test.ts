import { describe, expect, it } from "vitest";
import { GlitchClient } from "../src/glitchClient.js";
import { glitchToolDefinitions } from "../src/tools.js";
import { safeTool } from "../src/result.js";
import { createFetchMock, expectAuthorization, jsonResponse } from "./helpers.js";

const titleId = "10000000-0000-4000-8000-000000000001";
const offerId = "10000000-0000-4000-8000-000000000002";
const config = {
  apiBaseUrl: "https://mcp.example.test",
  dashboardBaseUrl: "https://app.example.test",
  timeoutMs: 1000,
  clientName: "preorder-tests",
  defaultTitleId: titleId,
  token: "preorder-scope-token"
};

const definition = (name: string) => {
  const tool = glitchToolDefinitions.find(item => item.name === name);
  if (!tool) throw new Error("Missing preorder tool " + name);
  return tool;
};

const invoke = (name: string, client: GlitchClient, args: Record<string, unknown> = {}) =>
  safeTool(() => definition(name).handler(client, args));

describe("preorder MCP contracts", () => {
  it("discovers the full lifecycle using the selected title and bearer token", async () => {
    const operations = [
      "settings.get", "settings.update", "offers.list", "offers.get", "offers.create", "offers.update",
      "offers.activate", "offers.pause", "offers.archive", "keys.inventory", "keys.import", "keys.retire",
      "orders.list", "orders.get", "orders.refund", "readiness.get", "fulfillment.retry",
      "payments.reconcile", "emails.resend_receipt", "emails.resend_access", "hosting.integration.get"
    ];
    const mock = createFetchMock(() => jsonResponse({ data: {
      version: 1,
      abilities: ["commerce:read", "commerce:write", "commerce:finance", "commerce:fulfill"],
      operations,
      security: { plaintext_unused_keys_returned: false, title_scoped: true }
    } }));
    const response = await invoke("glitch_get_preorder_capabilities", new GlitchClient(config, mock.fetch));

    expect(response.isError).toBeUndefined();
    expect(mock.requests[0]?.url).toBe(config.apiBaseUrl + "/mcp/v1/titles/" + titleId + "/preorders/capabilities");
    expectAuthorization(mock.requests[0]?.init, "preorder-scope-token");
    expect((response.structuredContent?.data as any).security.plaintext_unused_keys_returned).toBe(false);
  });

  it("forwards offer/key/order operations without leaking plaintext keys in results", async () => {
    const secret = "AAAA-BBBB-CCCC-DDDD";
    const mock = createFetchMock(request => {
      const operation = request.url.split("/").at(-1);
      if (operation === "keys.import") {
        return jsonResponse({ data: { inserted: 1, duplicate_existing: 0, inventory: { available: 1 } } });
      }
      return jsonResponse({ data: { id: offerId, operation, status: "active", platform_key: secret } });
    });
    const client = new GlitchClient(config, mock.fetch);

    const imported = await invoke("glitch_preorder_operation", client, {
      operation: "keys.import",
      arguments: { offer_id: offerId, keys: [secret] }
    });
    expect(imported.isError).toBeUndefined();
    expect(mock.requests[0]?.body).toEqual({ arguments: { offer_id: offerId, keys: [secret] } });
    expect(JSON.stringify(imported)).not.toContain(secret);

    const listed = await invoke("glitch_preorder_operation", client, {
      operation: "orders.list",
      arguments: { offer_id: offerId }
    });
    expect(listed.isError).toBeUndefined();
    expect(JSON.stringify(listed)).not.toContain(secret);
    expectAuthorization(mock.requests[1]?.init, "preorder-scope-token");
  });

  it("rejects unsupported operation names before making a request", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: { ok: true } }));
    const response = await invoke("glitch_preorder_operation", new GlitchClient(config, mock.fetch), {
      operation: "keys.dump",
      arguments: { offer_id: offerId }
    });

    expect(response.isError).toBe(true);
    expect(mock.requests).toHaveLength(0);
  });
});
