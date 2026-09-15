import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Explicitly opt-in local integration. Uses normal account login and the real
 * compiled stdio MCP process against loopback HTTP, with no mocked fetch.
 * Supply the authorized synthetic fixture only through runtime environment.
 * One stable run SKU prevents a manual retry from creating a second draft.
 * Never run this as a migration/reset, financial test, or public/live fixture.
 */
const enabled = process.env.GLITCH_COMMERCE_LOCAL_E2E === "1";
type ObjectValue = Record<string, unknown>;

function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected structured local commerce response.");
  return value as ObjectValue;
}

function productState(product: ObjectValue): ObjectValue {
  return Object.fromEntries([
    "sku", "type", "status", "description", "media_ids", "prices", "grants",
    "localizations", "max_per_order", "starts_at", "ends_at"
  ].map(key => [key, product[key] ?? null]));
}

describe.skipIf(!enabled)("real local stdio MCP commerce", () => {
  it("creates only one draft and preserves all omitted fields on a name-only update", async () => {
    const apiBaseUrl = process.env.GLITCH_COMMERCE_E2E_API_URL || "http://127.0.0.1/api";
    if (apiBaseUrl !== "http://127.0.0.1/api") throw new Error("This authorized test is restricted to the exact loopback fixture API.");
    let fixture: ObjectValue;
    try { fixture = object(JSON.parse(process.env.GLITCH_COMMERCE_E2E_FIXTURE_JSON || "{}")); }
    catch { throw new Error("Supply the authorized synthetic fixture through runtime inputs; never add it to a test file."); }
    delete process.env.GLITCH_COMMERCE_E2E_FIXTURE_JSON;
    const titleId = typeof fixture.title_id === "string" ? fixture.title_id : "";
    const email = typeof fixture.email === "string" ? fixture.email : "";
    const password = typeof fixture.password === "string" ? fixture.password : "";
    const sku = process.env.GLITCH_COMMERCE_E2E_SKU || "";
    if (!/^87df[0-9a-f-]{32}$/.test(titleId) || !/^commerce-browser-[a-z0-9]+@example\.test$/.test(email) || !password) {
      throw new Error("Only the explicitly authorized synthetic local title/account fixture may be used.");
    }
    if (!/^mcp-stdio-e2e-[a-z0-9-]{8,70}$/.test(sku)) throw new Error("Supply one stable, unique MCP draft SKU for this authorized run and reuse it on retry.");

    const login = await fetch(`${apiBaseUrl}/auth/login`, {
      method: "POST", redirect: "error", headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email, password }), signal: AbortSignal.timeout(30000)
    });
    if (!login.ok) throw new Error(`Synthetic local account login failed with HTTP ${login.status}; response withheld.`);
    const payload = object(await login.json());
    const data = payload.data ? object(payload.data) : payload;
    const tokenData = data.token ? object(data.token) : data;
    let jwt = typeof tokenData.access_token === "string" ? tokenData.access_token : "";
    if (!jwt) throw new Error("Synthetic login returned no usable account token; response withheld.");
    fixture.password = "";

    const transport = new StdioClientTransport({
      command: process.execPath, args: [resolve("dist/cli.js"), "stdio"], cwd: process.cwd(), stderr: "pipe",
      env: {
        ...getDefaultEnvironment(), GLITCH_API_BASE_URL: apiBaseUrl, GLITCH_API_TOKEN: jwt,
        GLITCH_TITLE_ID: titleId, GLITCH_DASHBOARD_URL: "http://127.0.0.1:3000",
        GLITCH_MCP_ALLOW_LOCAL_FILE_READS: "false", GLITCH_MCP_TIMEOUT_MS: "30000"
      }
    });
    // Do not forward subprocess diagnostics that could contain upstream data.
    transport.stderr?.on("data", () => {});
    const client = new Client({ name: "authorized-local-commerce-e2e", version: "1.0.0" });
    const allowedTools = new Set([
      "glitch_get_microtransaction_capabilities", "glitch_list_microtransaction_products",
      "glitch_create_microtransaction_product", "glitch_update_microtransaction_product"
    ]);
    const call = async (name: string, args: ObjectValue = {}): Promise<ObjectValue> => {
      if (!allowedTools.has(name)) throw new Error("This test cannot call publication, payment, financial, or provider operations.");
      const result = await client.callTool({ name, arguments: { title_id: titleId, ...args } });
      if (result.isError) {
        const code = result.structuredContent?.code;
        throw new Error(`Local MCP ${name} failed (${typeof code === "string" ? code : "unknown"}); sensitive response withheld.`);
      }
      return object(result.structuredContent?.data);
    };
    const listProducts = async (): Promise<ObjectValue[]> => {
      const result = object((await call("glitch_list_microtransaction_products")).result);
      if (!Array.isArray(result.products)) throw new Error("Local MCP products response did not contain products.");
      return result.products.map(object);
    };

    let draftId: string | undefined;
    try {
      await client.connect(transport);
      const capabilities = await call("glitch_get_microtransaction_capabilities");
      expect(capabilities.title_id).toBe(titleId);
      expect(capabilities.commission_basis_points).toBe(1200);
      const operations = (capabilities.operations as unknown[]).map(object);
      for (const operation of ["products.list", "products.create", "products.update"]) {
        expect(operations.some(item => item.operation === operation)).toBe(true);
      }
      expect(operations.find(item => item.operation === "products.create")?.ability).toBe("commerce:write");
      expect(operations.find(item => item.operation === "products.update")?.requires_confirmation).toBe(true);

      const before = await listProducts();
      const gems = before.find(product => /gems/i.test(String(product.sku || product.name || "")));
      if (gems) expect(gems.title_id).toBe(titleId);
      const mediaIds = Array.isArray(gems?.media_ids) ? gems.media_ids.filter((id): id is string => typeof id === "string").slice(0, 1) : [];
      const expected = {
        sku, name: "MCP stdio local draft regression", description: "Synthetic local MCP setup test draft; not for publication.",
        type: "currency", status: "draft", media_ids: mediaIds,
        prices: [{ currency: "USD", country: "US", amount_minor: 199 }],
        grants: [{ key: `qa.${sku}`, quantity: 7, kind: "consumable" }]
      };
      let created = before.find(product => product.sku === sku);
      if (created) {
        // A previous timed-out run can be resumed only if its unique draft is
        // recognizably ours. Never edit another product merely because of a SKU.
        expect(created.status).toBe("draft");
        expect(created.description).toBe(expected.description);
        expect(created.grants).toEqual(expected.grants);
      } else {
        created = object((await call("glitch_create_microtransaction_product", { ...expected, confirm: true })).result);
      }
      draftId = String(created.id);
      expect(draftId).toMatch(/^[0-9a-f-]{36}$/);
      expect(created.title_id).toBe(titleId);
      expect(created.status).toBe("draft");
      expect(created.media_ids).toEqual(mediaIds);
      expect(created.prices).toEqual(expected.prices);
      expect(created.grants).toEqual(expected.grants);
      expect(created.max_per_order).toBe(1);
      const originalState = productState(created);
      const updatedName = "MCP stdio name-only preservation verified";
      const updated = object((await call("glitch_update_microtransaction_product", {
        product_id: draftId, name: updatedName, confirm: true
      })).result);
      expect(updated.id).toBe(draftId);
      expect(updated.name).toBe(updatedName);
      expect(productState(updated)).toEqual(originalState);
      expect(Number(updated.version)).toBe(Number(created.version) + 1);

      const after = await listProducts();
      const matching = after.filter(product => product.sku === sku);
      expect(matching).toHaveLength(1);
      expect(matching[0]?.id).toBe(draftId);
      expect(matching[0]?.name).toBe(updatedName);
      expect(productState(matching[0]!)).toEqual(originalState);
      expect(after.filter(product => product.status === "active").map(product => product.id).sort())
        .toEqual(before.filter(product => product.status === "active").map(product => product.id).sort());
      console.log(JSON.stringify({ result: "passed", draft_id: draftId, name_only_preserved: true, owned_media_reused: mediaIds.length > 0 }));
    } finally {
      await client.close();
      await transport.close();
      jwt = "";
      if (draftId) console.log(`Local MCP draft retained for review: ${draftId}`);
    }
  }, 120000);
});
