import { existsSync, readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import * as z from "zod/v4";
import { GLITCH_SERVER_INSTRUCTIONS } from "../src/instructions.js";
import { glitchToolDefinitions } from "../src/tools.js";

const controllerPath = new URL("../../backend/app/Http/Controllers/McpMicrotransactionController.php", import.meta.url);
const controller = existsSync(controllerPath) ? readFileSync(controllerPath, "utf8") : "";
const rawExample = controller.match(/\$guestExample = <<<'JS'\n([\s\S]*?)\nJS;/)?.[1];
if (controller && !rawExample) throw new Error("Missing backend integration.get executable REST bootstrap");
const titleId = "10000000-0000-4000-8000-000000000001";
const base = `/api/titles/${titleId}/microtransactions`;
const bootstrap = rawExample?.replaceAll("COMMERCE_BASE", base) ?? "";

describe.skipIf(!existsSync(controllerPath))("server integration.get direct REST example (requires sibling backend checkout)", () => {
  it("executes credential-free native fetch with actual one-data-envelope DTOs", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const catalog = { products: [] };
    const session = { id: "10000000-0000-4000-8000-000000000002", nonce: "test-guidance-nonce-123456" };
    const result = await runInNewContext(`(async () => { ${bootstrap}\n return {catalog, session}; })()`, {
      URL,
      window: { location: new URL("https://game.example.test") },
      crypto: { randomUUID: () => session.nonce },
      fetch: async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return { ok: true, status: calls.length === 1 ? 200 : 201, json: async () => ({ data: calls.length === 1 ? catalog : session }) };
      },
    });
    expect(result).toEqual({ catalog, session });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe(`https://your_glitch_api_host${base}/catalog?environment=sandbox&country=US&currency=USD`);
    expect(calls[1]?.url).toBe(`https://your_glitch_api_host${base}/checkout-sessions`);
    for (const call of calls) {
      expect(call.init.credentials).toBe("omit");
      expect(call.init.redirect).toBe("error");
      const headers = new Headers(call.init.headers);
      expect(headers.has("Origin")).toBe(false);
      expect(headers.has("Authorization")).toBe(false);
      expect(call.url).not.toContain("community_id");
    }
    expect(JSON.parse(String(calls[1]?.init.body))).toEqual({ product_id: "PRODUCT_ID", quantity: 1,
      country: "US", currency: "USD", environment: "sandbox", channel: "web",
      return_origin: "https://game.example.test", nonce: session.nonce });
  });

  it.each([{ ok: false, status: 403, body: { message: "Not available" } },
    { ok: true, status: 200, body: {} }])("fails visibly without creating checkout after invalid catalog response $status", async response => {
    let requests = 0;
    const work = runInNewContext(`(async () => { ${bootstrap}\n })()`, {
      URL, window: { location: new URL("https://game.example.test") },
      crypto: { randomUUID: () => "test-guidance-nonce-123456" },
      fetch: async () => { requests++; return { ...response, json: async () => response.body }; },
    });
    await expect(work).rejects.toThrow("Commerce request failed");
    expect(requests).toBe(1);
  });
});

describe("REST-first documentation boundaries", () => {
  it("advertises optional SDK rather than a package prerequisite", () => {
    expect(GLITCH_SERVER_INSTRUCTIONS).toContain("Prefer direct REST API access");
    expect(GLITCH_SERVER_INSTRUCTIONS).toContain("No npm package, SDK import or SDK version is a prerequisite");
    expect(GLITCH_SERVER_INSTRUCTIONS).not.toContain("tutorial needs SDK3.15");
    for (const path of ["../docs/microtransactions.md", "../../glitch-myrriame/guides/microtransactions.md"]) {
      const file = new URL(path, import.meta.url);
      if (path.startsWith("../../") && !existsSync(file)) continue; // Optional sibling SDK checkout; local package guide is always checked.
      const text = readFileSync(file, "utf8");
      expect(text).toMatch(/Prefer (?:native fetch\/HTTP|direct REST API access)/);
      expect(text).toContain("fetch(");
      expect(text.indexOf("fetch(")).toBeLessThan(text.indexOf("import Glitch") < 0 ? Infinity : text.indexOf("import Glitch"));
      expect(text).toContain("Browser supplies Origin automatically");
      expect(text).toContain("commerce-only");
    }
  });

  it("documents commerce-only media without reintroducing confirmation or mislabeling writes", () => {
    const upload = glitchToolDefinitions.find(tool => tool.name === "glitch_upload_microtransaction_media")!;
    expect(upload.description).toContain("commerce-only");
    expect(upload.description).toContain("Must not appear in title/game previews, galleries");
    expect(upload.description).toContain("uploaded separately via commerce, not relinked");
    expect(upload.readOnlyHint).toBe(false);
    expect(z.object(upload.inputSchema).safeParse({ file_path: "/tmp/commerce-image.png" }).success).toBe(true);
  });

  it("keeps documentation QA optional and Tax setup scoped to the processing account", () => {
    for (const path of ["../docs/microtransactions.md", "../../glitch-myrriame/guides/microtransactions.md"]) {
      const file = new URL(path, import.meta.url);
      if (!existsSync(file)) continue;
      const text = readFileSync(file, "utf8").replace(/\s+/g, " ");
      for (const fragment of ["not required to enable purchases or activate live", "https://docs.stripe.com/tax/set-up",
        "platform processing", "head_office", "platform_tax_settings", "cannot write platform Tax settings",
        "not a registration ID", "registrations, filing or liability"]) {
        expect(text.includes(fragment), `${path}: ${fragment}`).toBe(true);
      }
      expect(text).not.toContain("Run a real approved provider sandbox purchase");
    }
  });

  it.skipIf(!existsSync(controllerPath))("keeps backend current contracts optional without rewriting the historical proof-gate probe", () => {
    for (const path of ["../../backend/docs/microtransactions-api-contract.md", "../../backend/docs/mcp-commerce-direct-management-contract.md"]) {
      const text = readFileSync(new URL(path, import.meta.url), "utf8");
      expect(text).toContain("not required to enable purchases or activate live sales");
      expect(text).toContain("https://docs.stripe.com/tax/set-up");
      expect(text).toContain("platform processing account");
      expect(text).not.toMatch(/live still requires sandbox proof|retain the live proof requirement|enabled route, integration proof/);
    }
    const history = readFileSync(new URL("../../backend/docs/deployment/microtransactions-readiness.md", import.meta.url), "utf8");
    expect(history).toContain("Superseded September 20, 2026");
    expect(history).toContain('At 2026-09-16T14:24:15.671Z');
    expect(history).toContain('exact blockers array `["verified_sandbox_fulfillment_required"]`');
    expect(history).toContain("original timestamps, observed blocker, test counts and outcomes below are intentionally preserved");
  });
});
