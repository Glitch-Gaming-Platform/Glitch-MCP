import { describe, expect, it } from "vitest";
import { GlitchClient } from "../src/glitchClient.js";
import { glitchToolDefinitions } from "../src/tools.js";
import { safeTool } from "../src/result.js";
import { createFetchMock, jsonResponse, expectAuthorization } from "./helpers.js";
import * as z from "zod/v4";
import { sanitizeMicrotransactionResult } from "../src/microtransactionTools.js";

const titleId = "10000000-0000-4000-8000-000000000001";
const orderId = "10000000-0000-4000-8000-000000000002";
const refundId = "10000000-0000-4000-8000-000000000003";
const deliveryId = "10000000-0000-4000-8000-000000000004";
const config = { apiBaseUrl: "https://mcp.example.test", dashboardBaseUrl: "https://app.example.test", timeoutMs: 1000, clientName: "management-tests", defaultTitleId: titleId, token: "test-scope-token" };
const definition = (name: string) => {
  const tool = glitchToolDefinitions.find(item => item.name === name);
  if (!tool) throw new Error(`Missing management tool ${name}`);
  return tool;
};
const invoke = (name: string, client: GlitchClient, args: Record<string, unknown> = {}) => safeTool(() => definition(name).handler(client, args));

describe("direct commerce management contracts", () => {
  it("preserves absent/false/true integration proof separately from configuration readiness", async () => {
    const legacy = { ready: true, status: "ready", blockers: [], providers: [], commission_basis_points: 1200 };
    for (const result of [legacy, { ...legacy, configuration_ready: true, integration_verified: false }, { ...legacy, configuration_ready: true, integration_verified: true }]) {
      const mock = createFetchMock(() => jsonResponse({ data: { operation: "readiness.get", result } }));
      const response = await invoke("glitch_get_microtransaction_readiness", new GlitchClient(config, mock.fetch));
      expect(response.isError).toBeUndefined();
      expect((response.structuredContent?.data as any).result).toEqual(result);
      expect(mock.requests).toHaveLength(1);
      expectAuthorization(mock.requests[0]?.init, "test-scope-token");
    }
  });
  it("discovers later catalog pages and exact SKUs with a distinct 200-product default", async () => {
    const pagination = { page: 2, per_page: 1, total: 3, last_page: 3, has_more_pages: true };
    const mock = createFetchMock(() => jsonResponse({ data: { operation: "products.list", result: { products: [{ id: orderId, sku: "older.exact-sku" }], pagination } } }));
    const client = new GlitchClient(config, mock.fetch);
    const filters = { page: 2, per_page: 1, status: "archived", sku: "older.exact-sku" };
    const result = await invoke("glitch_list_microtransaction_products", client, filters);
    expect(result.isError).toBeUndefined();
    expect(mock.requests[0]?.body).toEqual({ arguments: filters });
    expect((result.structuredContent?.data as any).result.pagination).toEqual(pagination);
    await invoke("glitch_list_microtransaction_products", client);
    expect(mock.requests[1]?.body).toEqual({ arguments: { page: 1, per_page: 200 } });
    for (const args of [{ page: 0 }, { page: 10001 }, { per_page: 201 }, { status: "unknown" }, { sku: "" }, { sku: "*" }, { environment: "sandbox" }]) {
      expect((await invoke("glitch_list_microtransaction_products", client, args)).isError).toBe(true);
    }
    expect(mock.requests).toHaveLength(2);
  });

  it("preserves omitted provider fields, especially the owned payout source", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: { operation: "providers.update", result: { provider: "stripe", enabled: true } } }));
    const client = new GlitchClient(config, mock.fetch);
    const input = Object.freeze({ provider: "stripe", environment: "sandbox", priority: 17 });
    const result = await invoke("glitch_update_microtransaction_provider", client, input);
    expect(result.isError).toBeUndefined();
    expect(mock.requests[0]?.body).toEqual({ arguments: input });
    expect((mock.requests[0]?.body as any).arguments).not.toHaveProperty("payout_source");
    await invoke("glitch_update_microtransaction_provider", client, { ...input, payout_source: "managed" });
    expect(mock.requests[1]?.body).toEqual({ arguments: { ...input, payout_source: "managed" } });
  });

  it("routes every lifecycle tool without confirmation, with truthful write metadata", async () => {
    const mock = createFetchMock(request => {
      const operation = request.url.split("/").at(-1);
      return jsonResponse({ data: { operation, result: operation === "providers.onboarding" ? { onboarding_url: "https://connect.stripe.com/setup/test-fixture", status: "requires_provider_onboarding" } : { status: "pending", available: false } } });
    });
    const client = new GlitchClient(config, mock.fetch);
    const cases: Array<[string, string, Record<string, unknown>, boolean]> = [
      ["glitch_update_microtransaction_provider", "providers.update", { provider: "stripe", environment: "sandbox", enabled: false, priority: 10 }, false],
      ["glitch_refresh_microtransaction_provider", "providers.refresh", { provider: "stripe", environment: "sandbox" }, false],
      ["glitch_create_microtransaction_provider_onboarding", "providers.onboarding", { environment: "sandbox", country: "US", idempotency_key: "fixed-onboarding-intent" }, false],
      ["glitch_get_microtransaction_delivery_settings", "delivery.settings.get", { environment: "sandbox" }, true],
      ["glitch_update_microtransaction_delivery_settings", "delivery.settings.update", { environment: "sandbox", enabled: false }, false],
      ["glitch_reconcile_microtransaction_order", "orders.reconcile", { order_id: orderId }, false],
      ["glitch_list_microtransaction_refunds", "refunds.list", { order_id: orderId }, true],
      ["glitch_get_microtransaction_refund", "refunds.get", { refund_id: refundId }, true],
      ["glitch_refund_microtransaction_order", "refunds.create", { order_id: orderId, reason: "Test refund", idempotency_key: "fixed-refund-intent" }, false],
      ["glitch_reconcile_microtransaction_refund", "refunds.reconcile", { refund_id: refundId }, false],
      ["glitch_list_microtransaction_deliveries", "deliveries.list", { order_id: orderId }, true],
      ["glitch_replay_microtransaction_delivery", "deliveries.replay", { delivery_id: deliveryId }, false],
      ["glitch_acknowledge_microtransaction_delivery", "deliveries.acknowledge", { delivery_id: deliveryId, event_id: deliveryId }, false],
      ["glitch_list_microtransaction_payouts", "payouts.list", { order_id: orderId }, true],
    ];
    for (const [name, operation, args, readOnly] of cases) {
      const result = await invoke(name, client, args);
      expect(result.isError, name).toBeUndefined();
      const request = mock.requests.at(-1)!;
      expect(request.url).toBe(`${config.apiBaseUrl}/mcp/v1/titles/${titleId}/microtransactions/operations/${operation}`);
      expect(request.body).not.toHaveProperty("confirm");
      expect(definition(name).readOnlyHint).toBe(readOnly);
      expect(definition(name).destructiveHint).toBe(!readOnly);
      expectAuthorization(request.init, "test-scope-token");
    }
    expect(mock.requests.find(request => request.url.endsWith("refunds.list"))?.body).toEqual({ arguments: { environment: "sandbox", order_id: orderId, page: 1, per_page: 25 } });
  });

  it("requires and reuses caller refund identity through unknown, success and conflict", async () => {
    const mock = createFetchMock((request, index) => index === 2
      ? jsonResponse({ code: "idempotency_conflict", message: "Same key has different refund input." }, 409)
      : jsonResponse({ data: { operation: request.url.split("/").at(-1), result: { refund_id: refundId, status: index === 0 ? "unknown" : "succeeded", order_id: orderId } } }));
    const client = new GlitchClient(config, mock.fetch);
    const args = { order_id: orderId, reason: "Buyer refund", amount_minor: 99, idempotency_key: "one-persisted-refund-intent" };
    const missing = await invoke("glitch_refund_microtransaction_order", client, { order_id: orderId, reason: "Buyer refund" });
    expect(missing.isError).toBe(true); expect(mock.requests).toHaveLength(0);
    const first = await invoke("glitch_refund_microtransaction_order", client, args);
    expect((first.structuredContent?.data as any).result.status).toBe("unknown");
    const retry = await invoke("glitch_refund_microtransaction_order", client, { ...args, confirm: false });
    expect((retry.structuredContent?.data as any).result.status).toBe("succeeded");
    expect(mock.requests[0]?.body).toEqual(mock.requests[1]?.body);
    const conflict = await invoke("glitch_refund_microtransaction_order", client, { ...args, amount_minor: 100 });
    expect(conflict.isError).toBe(true);
    expect(conflict.structuredContent?.code).toBe("conflict");
    expect((conflict.structuredContent?.details as any).upstreamCode).toBe("idempotency_conflict");
    expect((mock.requests[2]?.body as any).arguments.idempotency_key).toBe(args.idempotency_key);
  });

  it("returns actionable unavailable facts/errors rather than pretending provider setup succeeded", async () => {
    const mock = createFetchMock((request, index) => index === 0
      ? jsonResponse({ data: { operation: "providers.refresh", result: { provider: "xsolla", available: false, configured: false, reasons: ["platform_credentials_missing"] } } })
      : jsonResponse({ message: "The provider account could not be queried; retry the same operation later.", code: "provider_account_unavailable" }, 503));
    const client = new GlitchClient(config, mock.fetch);
    const first = await invoke("glitch_refresh_microtransaction_provider", client, { provider: "xsolla", environment: "sandbox" });
    expect(first.isError).toBeUndefined();
    expect((first.structuredContent?.data as any).result).toMatchObject({ available: false, reasons: ["platform_credentials_missing"] });
    const next = await invoke("glitch_refresh_microtransaction_provider", client, { provider: "stripe", environment: "sandbox" });
    expect(next.isError).toBe(true);
    expect((next.structuredContent?.details as any).upstreamCode).toBe("provider_account_unavailable");
    expect(mock.requests).toHaveLength(2);
  });

  it("rejects empty or malformed successful responses, not false-success summaries", async () => {
    for (const data of [null, [], {}, { operation: "settings.update" }, { operation: "settings.update", result: null }, { operation: "settings.update", result: {} }, { operation: "other", result: { enabled: false } }]) {
      const mock = createFetchMock(() => jsonResponse({ data }));
      const result = await invoke("glitch_update_microtransaction_settings", new GlitchClient(config, mock.fetch), { enabled: false });
      expect(result.isError).toBe(true);
      expect(result.structuredContent?.code).toBe("upstream_error");
    }
  });

  it("does not return an unexpected provider onboarding destination", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: { operation: "providers.onboarding", result: { onboarding_url: "https://untrusted.example/setup" } } }));
    const result = await invoke("glitch_create_microtransaction_provider_onboarding", new GlitchClient(config, mock.fetch), { environment: "sandbox", country: "US", idempotency_key: "stable-onboarding-key" });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain("untrusted.example");
  });

  it("allows only scoped project-secret input and never emits it in results", async () => {
    const secret = "test-only-project-webhook-secret";
    const mock = createFetchMock(() => jsonResponse({ data: { operation: "providers.update", result: { configured: false, credentials_exposed: false, configuration: { webhook_secret: secret }, reasons: ["platform_credentials_missing"] } } }));
    const client = new GlitchClient(config, mock.fetch);
    const result = await invoke("glitch_update_microtransaction_provider", client, { provider: "xsolla", environment: "sandbox", project_id: "123456", webhook_secret: secret });
    expect(result.isError).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(secret);
    expect((result.structuredContent?.data as any).result.credentials_exposed).toBe(false);
    for (const extra of [{ api_key: "test-should-never-forward" }, { approved: true }, { available: true }, { connected_account_id: "arbitrary-payee" }, { private_key: "not-a-signing-key" }]) {
      const denied = await invoke("glitch_update_microtransaction_provider", client, { provider: "stripe", environment: "sandbox", ...extra });
      expect(denied.isError).toBe(true);
    }
    expect(mock.requests).toHaveLength(1);
    const schema = z.toJSONSchema(definition("glitch_update_microtransaction_provider").validationSchema!, { io: "input" });
    expect((schema.properties?.webhook_secret as { writeOnly?: boolean }).writeOnly).toBe(true);
  });

  it("retains write-only discovery schemas while redacting secret values and schema defaults", () => {
    const result = sanitizeMicrotransactionResult({
      operations: [{ input_schema: { type: "object", properties: { webhook_secret: { type: "string", minLength: 16, maxLength: 512, writeOnly: true, default: "never-return-this-value" } } } }],
      configuration: { webhook_secret: "never-return-this-value" }, credentials_exposed: false
    }) as any;
    expect(result.operations[0].input_schema.properties.webhook_secret).toMatchObject({ type: "string", minLength: 16, maxLength: 512, writeOnly: true });
    expect(result.operations[0].input_schema.properties.webhook_secret).not.toHaveProperty("default");
    expect(result.configuration.webhook_secret).toBe("[redacted]");
    expect(result.credentials_exposed).toBe(false);
    expect(JSON.stringify(result)).not.toContain("never-return-this-value");
  });
});
