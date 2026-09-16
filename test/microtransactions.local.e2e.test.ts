import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Opt-in REAL stdio MCP -> isolated loopback Laravel verification.
 * Fixture creation/server startup belongs to the backend test owner, who must
 * verify PostgreSQL current_database() before seeding. Never target the normal
 * browser fixture, production API, or use a user JWT as a substitute MCP token.
 * All fixture tokens arrive only through runtime input and are never printed.
 */
const enabled = process.env.GLITCH_COMMERCE_LOCAL_E2E === "1";
const database = "glitch_commerce_regression_20260914_01a0a11e";
type ObjectValue = Record<string, unknown>;
type Fixture = {
  fixture_type: string; database: string; api_base_url: string;
  title_id: string; other_title_id: string; full_token: string; read_only_token: string;
  run_id: string; refund_order_id?: string; refund_amount_minor?: number;
  refund_idempotency_key?: string; reconcile_order_id?: string; media_id?: string;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected structured local commerce response; payload withheld.");
  return value as ObjectValue;
}
function rows(value: unknown): ObjectValue[] {
  if (!Array.isArray(value)) throw new Error("Expected local commerce list; payload withheld.");
  return value.map(object);
}
function state(product: ObjectValue): ObjectValue {
  return Object.fromEntries(["sku", "type", "status", "description", "media_ids", "prices", "grants", "localizations", "max_per_order", "starts_at", "ends_at"].map(key => [key, product[key] ?? null]));
}

describe.skipIf(!enabled)("real title-MCP direct commerce management", () => {
  let fixture: Fixture;
  let full: Client;
  let readOnly: Client;
  const transports: StdioClientTransport[] = [];
  let productId: string | undefined;
  let refundId: string | undefined;
  const allowedTools = new Set([
    "glitch_get_microtransaction_capabilities", "glitch_get_microtransaction_settings", "glitch_update_microtransaction_settings",
    "glitch_list_microtransaction_products", "glitch_create_microtransaction_product", "glitch_update_microtransaction_product",
    "glitch_archive_microtransaction_product", "glitch_list_microtransaction_providers", "glitch_update_microtransaction_provider",
    "glitch_refresh_microtransaction_provider", "glitch_get_microtransaction_readiness",
    "glitch_get_microtransaction_delivery_settings", "glitch_update_microtransaction_delivery_settings",
    "glitch_list_microtransaction_orders", "glitch_get_microtransaction_order", "glitch_reconcile_microtransaction_order",
    "glitch_list_microtransaction_refunds", "glitch_get_microtransaction_refund", "glitch_refund_microtransaction_order",
    "glitch_request_microtransaction_refund", "glitch_reconcile_microtransaction_refund",
    "glitch_list_microtransaction_deliveries", "glitch_replay_microtransaction_delivery",
    "glitch_list_microtransaction_payouts", "glitch_get_microtransaction_earnings",
  ]);

  async function connect(token: string): Promise<Client> {
    const transport = new StdioClientTransport({
      command: process.execPath, args: [resolve("dist/cli.js"), "stdio"], cwd: process.cwd(), stderr: "pipe",
      env: { ...getDefaultEnvironment(), GLITCH_API_BASE_URL: fixture.api_base_url, GLITCH_API_TOKEN: token,
        GLITCH_TITLE_ID: fixture.title_id, GLITCH_DASHBOARD_URL: new URL(fixture.api_base_url).origin,
        GLITCH_MCP_ALLOW_LOCAL_FILE_READS: "false", GLITCH_MCP_TIMEOUT_MS: "30000" },
    });
    transport.stderr?.on("data", () => {}); // No upstream/private diagnostics in test output.
    transports.push(transport);
    const client = new Client({ name: "isolated-title-mcp-commerce", version: "1.0.0" });
    await client.connect(transport);
    return client;
  }

  async function raw(client: Client, name: string, args: ObjectValue = {}, titleId = fixture.title_id) {
    if (!allowedTools.has(name)) throw new Error("Operation outside this isolated commerce test.");
    try { return await client.callTool({ name, arguments: { ...args, title_id: titleId } }); }
    catch { throw new Error("Local MCP transport failed; sensitive diagnostics withheld."); }
  }
  async function call(name: string, args: ObjectValue = {}): Promise<ObjectValue> {
    const result = await raw(full, name, args);
    if (result.isError) throw new Error("Authorized local MCP operation failed: " + name + "; code=" + String(result.structuredContent?.code || "unknown"));
    const data = object(result.structuredContent?.data);
    return name === "glitch_get_microtransaction_capabilities" ? data : object(data.result);
  }

  beforeAll(async () => {
    let input: unknown;
    try { input = JSON.parse(process.env.GLITCH_COMMERCE_E2E_FIXTURE_JSON || "{}"); }
    catch { throw new Error("Provide isolated fixture JSON only through runtime input."); }
    delete process.env.GLITCH_COMMERCE_E2E_FIXTURE_JSON;
    fixture = object(input) as unknown as Fixture;
    let base: URL;
    try { base = new URL(fixture.api_base_url); }
    catch { throw new Error("Invalid isolated fixture API URL; input withheld."); }
    if (fixture.fixture_type !== "isolated-commerce-management" || fixture.database !== database
      || base.hostname !== "127.0.0.1" || !["http:", "https:"].includes(base.protocol)
      || !base.port || ["80", "443"].includes(base.port) || base.pathname !== "/api"
      || base.search || base.hash || base.username || base.password
      || !uuid.test(fixture.title_id) || !uuid.test(fixture.other_title_id) || fixture.title_id === fixture.other_title_id
      || !/^[a-z0-9-]{8,40}$/.test(fixture.run_id)) {
      throw new Error("Only an explicitly isolated loopback fixture/test database is permitted; normal demo/browser data is forbidden.");
    }
    for (const value of [fixture.full_token, fixture.read_only_token]) {
      if (typeof value !== "string" || !value.startsWith("gl_mcp_") || value.length < 40) throw new Error("Real title-MCP fixture credentials are required, never user JWTs; values withheld.");
    }
    if (fixture.full_token === fixture.read_only_token) throw new Error("Distinct full and read-only MCP fixture credentials are required.");
    full = await connect(fixture.full_token);
    readOnly = await connect(fixture.read_only_token);
  }, 90000);

  afterAll(async () => {
    await full?.close(); await readOnly?.close();
    for (const transport of transports) await transport.close();
    if (fixture) { fixture.full_token = ""; fixture.read_only_token = ""; }
    if (productId) console.log("Isolated MCP product retained for backend test cleanup: " + productId);
    if (refundId) console.log("Isolated MCP refund operation: " + refundId);
  });

  it("uses real MCP tokens: direct writes work while readonly and cross-title writes remain denied", async () => {
    const capabilities = await call("glitch_get_microtransaction_capabilities");
    expect(capabilities.title_id).toBe(fixture.title_id);
    const operations = rows(capabilities.operations);
    for (const name of ["providers.update", "providers.refresh", "providers.onboarding", "delivery.settings.update", "orders.reconcile", "refunds.create", "refunds.reconcile", "deliveries.list", "payouts.list"]) {
      const operation = operations.find(value => value.operation === name);
      expect(Boolean(operation), name).toBe(true);
      expect(operation?.requires_confirmation).toBe(false);
      expect(operation?.requires_human_approval).toBe(false);
      expect(typeof operation?.mutates).toBe("boolean");
    }
    const deniedWrite = await raw(readOnly, "glitch_update_microtransaction_settings", { enabled: true, environment: "sandbox" });
    expect(deniedWrite.isError).toBe(true);
    expect(deniedWrite.structuredContent?.code).toBe("permission_denied");
    const deniedFinance = await raw(readOnly, "glitch_update_microtransaction_provider", { provider: "stripe", environment: "sandbox", enabled: false });
    expect(deniedFinance.isError).toBe(true);
    expect(deniedFinance.structuredContent?.code).toBe("permission_denied");
    const deniedOtherTitle = await raw(full, "glitch_get_microtransaction_capabilities", {}, fixture.other_title_id);
    expect(deniedOtherTitle.isError).toBe(true);
    expect(deniedOtherTitle.structuredContent?.code).toBe("permission_denied");
    const deniedOtherWrite = await raw(full, "glitch_update_microtransaction_settings", { enabled: false, environment: "sandbox" }, fixture.other_title_id);
    expect(deniedOtherWrite.isError).toBe(true);
    expect(deniedOtherWrite.structuredContent?.code).toBe("permission_denied");

    const playerQuery = await fetch(fixture.api_base_url + "/titles/" + fixture.title_id + "/microtransactions/me/purchases?environment=sandbox",
      { headers: { Authorization: "Bearer " + fixture.full_token, Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(10000) });
    expect([401, 403]).toContain(playerQuery.status); // MCP cannot impersonate a game player.

    const settings = await call("glitch_update_microtransaction_settings", { enabled: true, environment: "sandbox", countries: ["US"], currencies: ["USD"],
      support_email: "support@example.test", allowed_origins: ["https://isolated-game.example"], fulfillment_mode: "glitch", ads_enabled: true });
    expect(settings.environment).toBe("sandbox");
    const route = await call("glitch_update_microtransaction_provider", { provider: "stripe", environment: "sandbox", enabled: true,
      priority: 10, countries: ["US"], currencies: ["USD"], minimum_amounts: { USD: 50 }, tax_mode: "disabled", payout_source: "platform" });
    expect(route.provider).toBe("stripe"); expect(route.environment).toBe("sandbox");
    expect(route.enabled).toBe(true); expect(route).not.toHaveProperty("approved");
    const facts = await call("glitch_refresh_microtransaction_provider", { provider: "stripe", environment: "sandbox" });
    expect(typeof facts.configured).toBe("boolean"); expect(typeof facts.available).toBe("boolean"); expect(Array.isArray(facts.reasons)).toBe(true);
    const unsupportedFlag = await raw(full, "glitch_update_microtransaction_provider", { provider: "stripe", environment: "sandbox", available: true });
    expect(unsupportedFlag.isError).toBe(true);
    const vendors = rows((await call("glitch_list_microtransaction_providers", { environment: "sandbox" })).providers);
    expect(vendors.some(value => value.provider === "stripe")).toBe(true);
    for (const vendor of vendors) {
      if (!vendor.configured) { expect(vendor.available).toBe(false); expect(rowsOrStrings(vendor.reasons).length).toBeGreaterThan(0); }
    }

    const delivery = await call("glitch_update_microtransaction_delivery_settings", { environment: "sandbox", enabled: false });
    expect(delivery.signature_algorithm).toBe("ed25519");
    expect(Buffer.from(String(delivery.verification_public_key), "base64").length).toBe(32);
    expect(delivery).not.toHaveProperty("private_key");
    const sameKey = await call("glitch_get_microtransaction_delivery_settings", { environment: "sandbox" });
    expect(sameKey.verification_public_key).toBe(delivery.verification_public_key);

    const sku = "mcp-management-e2e-" + fixture.run_id;
    const before = rows((await call("glitch_list_microtransaction_products", { sku })).products);
    let product = before.find(value => value.sku === sku);
    if (!product) product = await call("glitch_create_microtransaction_product", {
      sku, name: "Isolated MCP direct-management test", description: "Isolated test product, not a real user game.",
      type: "currency", status: "draft", media_ids: fixture.media_id ? [fixture.media_id] : [],
      prices: [{ currency: "USD", country: "US", amount_minor: 199 }],
      grants: [{ key: "test-resource-" + fixture.run_id, quantity: 7, kind: "consumable" }],
    });
    expect(product.status).toBe("draft");
    productId = String(product.id);
    const savedState = state(product);
    const renamed = await call("glitch_update_microtransaction_product", { product_id: productId, name: "Direct MCP name-only update verified" });
    expect(state(renamed)).toEqual(savedState);
    const active = await call("glitch_update_microtransaction_product", { product_id: productId, status: "active", confirm: false });
    expect(active.status).toBe("active");
    const archived = await call("glitch_archive_microtransaction_product", { product_id: productId });
    expect(archived.status).toBe("archived");
    // Restore this isolated SKU to draft so a rerun reuses the same resource.
    await call("glitch_update_microtransaction_product", { product_id: productId, status: "draft" });
    const exactResult = await call("glitch_list_microtransaction_products", { sku, status: "draft", per_page: 1 });
    const after = rows(exactResult.products);
    expect(after.filter(value => value.sku === sku)).toHaveLength(1);
    expect(object(exactResult.pagination).total).toBe(1);
    const secondPage = await call("glitch_list_microtransaction_products", { page: 2, per_page: 1 });
    expect(object(secondPage.pagination).page).toBe(2);
    expect(rows(secondPage.products)).toHaveLength(1); // Captured-order SKU plus this newly created test SKU.
    expect(object((await call("glitch_list_microtransaction_orders", { environment: "sandbox", page: 1, per_page: 25 })).pagination).per_page).toBe(25);
    expect(Array.isArray((await call("glitch_list_microtransaction_deliveries", { environment: "sandbox" })).deliveries)).toBe(true);
    expect(Array.isArray((await call("glitch_list_microtransaction_payouts", { environment: "sandbox" })).payouts)).toBe(true);
  }, 120000);

  it("executes a real Stripe-test refund once using the same caller key and original operation", async () => {
    if (!fixture.refund_order_id || !uuid.test(fixture.refund_order_id) || !Number.isInteger(fixture.refund_amount_minor)
      || (fixture.refund_amount_minor ?? 0) <= 0 || !fixture.refund_idempotency_key || fixture.refund_idempotency_key.length < 16) {
      throw new Error("A genuine captured Stripe TEST order and stable refund intent are required for financial E2E coverage; no fabricated paid fixture or browser-proof substitute.");
    }
    const order = await call("glitch_get_microtransaction_order", { order_id: fixture.refund_order_id });
    expect(order.environment).toBe("sandbox"); expect(order.provider).toBe("stripe");
    expect(Boolean(order.paid_at)).toBe(true);
    const args = { order_id: fixture.refund_order_id, amount_minor: fixture.refund_amount_minor,
      reason: "Isolated MCP lifecycle refund verification", idempotency_key: fixture.refund_idempotency_key };
    const denied = await raw(readOnly, "glitch_refund_microtransaction_order", args);
    expect(denied.isError).toBe(true); expect(denied.structuredContent?.code).toBe("permission_denied");
    const first = await call("glitch_refund_microtransaction_order", args);
    refundId = String(first.refund_id);
    expect(uuid.test(refundId)).toBe(true);
    const retry = await call("glitch_request_microtransaction_refund", args); // Legacy alias also executes, not approval.
    expect(retry.refund_id).toBe(refundId);
    const changed = await raw(full, "glitch_refund_microtransaction_order", { ...args, amount_minor: fixture.refund_amount_minor! + 1 });
    expect(changed.isError).toBe(true); expect(changed.structuredContent?.code).toBe("conflict");
    const found = await call("glitch_get_microtransaction_refund", { refund_id: refundId });
    expect(found.id).toBe(refundId); expect(found.idempotency_key).toBe(fixture.refund_idempotency_key);
    const reconciled = await call("glitch_reconcile_microtransaction_refund", { refund_id: refundId });
    expect(reconciled.id).toBe(refundId);
    // Pending/unknown/failed are valid operational states, but they are not
    // evidence that this real Stripe-test refund completed successfully.
    expect(reconciled.status).toBe("succeeded");
    expect(reconciled.order_refunded_minor).toBeGreaterThanOrEqual(fixture.refund_amount_minor!);
    const refunds = rows((await call("glitch_list_microtransaction_refunds", { environment: "sandbox", order_id: fixture.refund_order_id })).refunds);
    expect(refunds.filter(value => value.idempotency_key === fixture.refund_idempotency_key)).toHaveLength(1);
    const target = fixture.reconcile_order_id || fixture.refund_order_id;
    const reconciledOrder = await call("glitch_reconcile_microtransaction_order", { order_id: target });
    expect(reconciledOrder.id).toBe(target); expect(reconciledOrder.environment).toBe("sandbox");
  }, 120000);
});

function rowsOrStrings(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Expected provider reasons array.");
  return value;
}
