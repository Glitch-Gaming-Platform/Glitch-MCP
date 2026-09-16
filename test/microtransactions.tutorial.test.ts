import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { describe, expect, it } from "vitest";
import { MICROTRANSACTION_CALLBACK_TUTORIAL } from "../src/microtransactionTutorial.js";

const example = MICROTRANSACTION_CALLBACK_TUTORIAL.match(/```js\n([\s\S]*?)\n```/)?.[1];
if (!example) throw new Error("Missing runnable generated starter");
const compiled = transpileModule(example, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2020 } }).outputText;

function fixture(key: unknown) {
  // Only the DOM and API transport are fixtures; execute the actual generated JS.
  const elements: Array<{ textContent: string; onclick?: () => void }> = [];
  const element = () => {
    const value = { textContent: "", append() {}, setAttribute() {} };
    elements.push(value);
    return value;
  };
  const calls: Array<{ kind: string; data: any; options?: any }> = [];
  let overlay: any;
  const open = (options: any) => { overlay = options; options.onOpen(); return { close: options.onClose }; };
  const api = {
    createCheckoutSession: async (_title: string, data: any) => {
      calls.push({ kind: "session", data });
      return { data: { data: { id: "test-session" } } };
    },
    consume: async (_title: string, data: any, options: any) => { calls.push({ kind: "consume", data, options }); },
    listEntitlements: async () => ({ data: { data: { entitlements: [{ key, kind: "consumable", balance: 90 }] } } }),
  };
  const sdk = {
    __esModule: true,
    default: { api: { Microtransactions: api }, util: { Requests: { setBaseUrl() {} } } },
    createMicrotransactionNonce: () => "test-only-action-nonce",
    openMicrotransactionOverlay: open,
    openMicrotransactionRestoreOverlay: open,
  };
  const exports: any = {};
  runInNewContext(compiled, { exports, URL, Date, Error,
    document: { body: element(), createElement: element }, window: { location: new URL("https://game.example.test") },
    require: (name: string) => { expect(name).toBe("glitch-javascript-sdk"); return sdk; },
  });
  const game = exports.installTimberShop({ titleId: "test-title", productId: "test-product", apiBaseUrl: "https://api.example.test/api",
    checkoutOrigin: "https://checkout.example.test", gameOrigin: "https://game.example.test", timberGrantKey: key });
  return {
    game, calls,
    async click(label: string) {
      const button = elements.find(item => item.textContent === label);
      expect(button?.onclick).toBeTypeOf("function");
      button!.onclick!();
      await new Promise(resolve => setImmediate(resolve));
    },
    verify(kind: string) { overlay.onVerified({ player_id: "test-player", player_token: "test-only-player-token",
      expires_at: new Date(Date.now() + 900000).toISOString(), entitlements: [{ key, kind, balance: 100 }] }); },
    close() { overlay.onClose(); },
  };
}

describe("generated generic Timber starter", () => {
  it.each(["timber", "gold", "Wood_01-pack", "wotw.resource.timber", "a".repeat(100)])("uses the exact existing consumable key %s", async key => {
    const f = fixture(key);
    await f.click("Buy 100 Timber"); f.verify("consumable"); f.close();
    await f.click("Use 10 Timber");
    const spent = f.calls.filter(call => call.kind === "consume");
    expect(spent).toHaveLength(1);
    expect(spent[0]?.data.key).toBe(key);
    expect(spent[0]?.options).toEqual({ playerToken: "test-only-player-token" });
    expect(f.game.inventory).toEqual([{ key, kind: "consumable", balance: 90 }]);
  });

  it.each(["timber", "wotw.resource.timber"])("rejects canonical durable kind regardless of the key %s", async key => {
    const f = fixture(key);
    await f.click("Buy 100 Timber");
    expect(() => f.verify("durable")).toThrow("kind mismatch");
    expect(f.game.playerId).toBeNull();
    expect(f.game.inventory).toEqual([]);
    f.close(); await f.click("Use 10 Timber");
    expect(f.calls.filter(call => call.kind === "consume")).toEqual([]);
  });

  it("requires an explicit key with the existing character/length grammar", () => {
    for (const key of [undefined, null, 42, "", "a".repeat(101), " timber", "timber/wood", "timber\n", "timbér"]) {
      expect(() => fixture(key)).toThrow("explicit grant key");
    }
  });

  it("keeps the WOTW proposal title-specific and public release notes free of task approval gates", () => {
    expect(MICROTRANSACTION_CALLBACK_TUTORIAL).toContain("WOTW-specific migration proposal");
    expect(MICROTRANSACTION_CALLBACK_TUTORIAL).toContain("title ID prefix ad467");
    expect(MICROTRANSACTION_CALLBACK_TUTORIAL).toContain("not globally reserved");
    expect(MICROTRANSACTION_CALLBACK_TUTORIAL).toContain("namespacing is optional");
    expect(MICROTRANSACTION_CALLBACK_TUTORIAL).toContain("does not create/publish products or prices or authorize a catalog mutation");
    for (const path of ["../docs/microtransactions.md", "../docs/auth.md", "../CHANGELOG.md"]) {
      const text = readFileSync(new URL(path, import.meta.url), "utf8");
      expect(text).not.toMatch(/parent review|parent-owned|let the parent|to the parent/i);
    }
  });
});
