import { existsSync, readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { COMMERCE_REST_STARTER_SOURCE } from "../src/commerceRestStarter.js";
import { MICROTRANSACTION_CALLBACK_TUTORIAL } from "../src/microtransactionTutorial.js";

const titleId = "10000000-0000-4000-8000-000000000001";
const productId = "10000000-0000-4000-8000-000000000002";
const sessionId = "10000000-0000-4000-8000-000000000003";
const orderId = "10000000-0000-4000-8000-000000000004";
const playerId = "10000000-0000-4000-8000-000000000005";
const restoreId = "10000000-0000-4000-8000-000000000006";
const checkoutOrigin = "https://checkout.example.test";
const playerToken = "gl_player_" + "p".repeat(64);
const sessionToken = "s".repeat(64);
const flush = async () => { await new Promise<void>(resolve => setImmediate(resolve)); };
const frontendSourcePath = new URL("../../Glitch-React-Frontend/src/templates/marketing/component/section/titles/commerceRestStarter.js", import.meta.url);

// Execute the actual dependency-free source; only network, browser DOM and clocks
// are deterministic fixtures. This is not provider integration or browser3DS proof.
function fixture(overrides: Record<string, unknown> = {}) {
  const timers = new Map<number, { fn: () => void; delay: number }>();
  const saved = new Map<string, string>();
  const elements: Element[] = [];
  const applied: any[] = [], calls: Array<{ url: URL; init: RequestInit; body?: any }> = [];
  let timerId = 0, paused = 0, resumed = 0;
  let handler: ((url: URL, init: RequestInit, body: any) => any) | undefined;
  let balance = 100, kind = "consumable", sessionNonce = "";
  const expiry = () => new Date(Date.now() + 900000).toISOString();
  const entitlements = () => [{ key: "timber", kind, balance, environment: "sandbox" }];
  const order: any = { id: orderId, title_id: titleId, environment: "sandbox", payment_status: "paid", fulfillment_status: "delivered" };
  const claim: any = { title_id: titleId, checkout_session_id: sessionId, order_id: orderId,
    player_id: playerId, player_token: playerToken, expires_at: expiry(), entitlements: entitlements() };

  class Events {
    listeners = new Map<string, Set<(event: any) => void>>();
    addEventListener(name: string, fn: (event: any) => void) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name)!.add(fn); }
    removeEventListener(name: string, fn: (event: any) => void) { this.listeners.get(name)?.delete(fn); }
    emit(name: string, event: any = {}) { for (const fn of this.listeners.get(name) || []) fn(event); }
  }
  class Element extends Events {
    style: any = { overflow: "" }; attrs: Record<string, string> = {}; textContent = "";
    children: Element[] = []; parent: Element | null = null; disabled = false; isConnected = false;
    contentWindow: object | null; contentDocument: any; private valueText?: string; private url = "";
    constructor(readonly tagName: string) { super(); this.contentWindow = tagName === "iframe" ? {} : null; elements.push(this); }
    setAttribute(name: string, value: string) { this.attrs[name] = value; }
    connect(value: boolean) { this.isConnected = value; for (const child of this.children) child.connect(value); }
    append(...children: Element[]) { for (const child of children) { child.parent = this; child.connect(this.isConnected); this.children.push(child); } }
    replaceChildren(...children: Element[]) { for (const child of this.children) { child.parent = null; child.connect(false); } this.children = []; this.append(...children); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; this.connect(false); }
    focus() { doc.activeElement = this; }
    showModal() { this.attrs.open = ""; }
    get value() { return this.valueText ?? ""; }
    set value(value: string) { this.valueText = value; }
    get src() { return this.url; }
    set src(value: string) { this.url = value; this.contentDocument = value === "about:blank" ? { URL: "about:blank", readyState: "complete" } : null; }
    click() { if (!this.disabled) this.emit("click"); }
  }
  const body = new Element("body"); body.isConnected = true;
  const doc: any = { body, activeElement: body, createElement: (tag: string) => new Element(tag) };
  const canvas = new Element("canvas"); canvas.textContent = "unchanged-game-score:20"; body.append(canvas); canvas.focus();
  const win = Object.assign(new Events(), {
    location: new URL("https://game.example.test/playing"),
    setTimeout(fn: () => void, delay: number) { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id: number) { timers.delete(id); },
    sessionStorage: { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value), removeItem: (key: string) => saved.delete(key) }
  });
  function session(restoring: boolean, input: any) {
    const id = restoring ? restoreId : sessionId; sessionNonce = input.nonce;
    return { id, checkout_session_id: id, nonce: input.nonce, session_token: sessionToken,
      expires_at: expiry(), ...(restoring ? { intent: "restore" } : {}),
      hosted_url: checkoutOrigin + "/games/" + titleId + "/checkout/" + id + "#token=" + sessionToken };
  }
  const fetchFixture = async (raw: string, init: RequestInit) => {
    const url = new URL(raw), data = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, init, body: data });
    const custom = handler?.(url, init, data);
    if (custom !== undefined) return custom;
    let result: any;
    if (url.pathname.endsWith("/catalog")) result = { title: { id: titleId }, environment: "sandbox", available: true,
      products: [{ id: productId, name: "100 Timber", status: "active", grants: [{ key: "timber", kind: "consumable", quantity: 100 }] }] };
    else if (url.pathname.endsWith("/checkout-sessions")) result = session(false, data);
    else if (url.pathname.endsWith("/restore-sessions")) result = session(true, data);
    else if (url.pathname.endsWith("/handoffs/claim")) result = claim;
    else if (url.pathname.endsWith("/orders/" + orderId)) result = order; // Actual own receipt has no player_id.
    else if (url.pathname.endsWith("/entitlements")) result = { entitlements: entitlements() };
    else if (url.pathname.endsWith("/consume")) result = { entitlement: entitlements()[0], replayed: false };
    else if (url.pathname.endsWith("/me/purchases")) result = { title_id: titleId, player_id: playerId, environment: "sandbox",
      purchases: [{ ...order, player_id: playerId, product: { id: null, name: null, sku: null, type: null, version: null }, grant_usage: [] }],
      pagination: { page: Number(url.searchParams.get("page")), per_page: 20, total: 1, last_page: 1, has_more_pages: false } };
    else if (/\/checkout-sessions\/[^/]+$/.test(url.pathname)) result = { id: sessionId, checkout_session_id: sessionId, title: { id: titleId },
      environment: "sandbox", nonce: sessionNonce, return_origin: win.location.origin, order };
    else throw new Error("Unexpected tutorial request path");
    return { ok: true, status: 200, json: async () => ({ data: result }) };
  };
  const create = runInNewContext(COMMERCE_REST_STARTER_SOURCE + "\ncreateGlitchRestShop", {
    window: win, document: doc, URL, URLSearchParams, Date, AbortController, Uint8Array, crypto: webcrypto, fetch: fetchFixture
  });
  const shop = create({ apiBase: "https://api.example.test/api", checkoutOrigin, titleId, environment: "sandbox",
    country: "US", currency: "USD", spendKey: "timber", onInventory: (value: any) => applied.push(value),
    pauseGame: () => { paused++; }, resumeGame: () => { resumed++; }, ...overrides });
  function button(label: string) {
    const node = elements.find(element => element.tagName === "button" && element.isConnected && element.textContent === label);
    if (!node) throw new Error("Missing button: " + label);
    return node;
  }
  function frame() { return elements.find(element => element.tagName === "iframe" && element.isConnected)!; }
  return {
    calls, applied, saved, timers, win, doc, order, claim, canvas, shop,
    get paused() { return paused; }, get resumed() { return resumed; },
    setBalance(value: number) { balance = value; }, setKind(value: string) { kind = value; },
    handle(value: typeof handler) { handler = value; },
    button, frame,
    async click(label: string) { button(label).click(); await flush(); },
    async open(restoring = false) { await flush(); await this.click(restoring ? "Restore my purchases" : "Buy selected item"); },
    async message(patch: Record<string, unknown> = {}, envelope: Record<string, unknown> = {}) {
      win.emit("message", { source: frame()?.contentWindow, origin: checkoutOrigin,
        data: { type: "glitch.microtransaction.updated", version: 1, title_id: titleId, checkout_session_id: sessionId,
          nonce: sessionNonce, order_id: orderId, claim_code: "c".repeat(64), ...patch }, ...envelope }); await flush();
    },
    fireWatchdog() { for (const [id, timer] of [...timers]) if (timer.delay === 20000) { timers.delete(id); timer.fn(); } },
    text() { return elements.filter(element => element.isConnected).map(element => element.textContent).join("\n"); }
  };
}

describe("canonical REST tutorial", () => {
  it.skipIf(!existsSync(frontendSourcePath))("mirrors frontend source exactly (requires sibling frontend checkout)", () => {
    const source = readFileSync(frontendSourcePath, "utf8");
    const frontend = runInNewContext(source.replace("export const", "const") + "\nCOMMERCE_REST_STARTER_SOURCE");
    expect(COMMERCE_REST_STARTER_SOURCE).toBe(frontend);
  });

  it("includes the exact executable starter without SDK import or package prerequisite", () => {
    expect(MICROTRANSACTION_CALLBACK_TUTORIAL).toContain(COMMERCE_REST_STARTER_SOURCE);
    expect(MICROTRANSACTION_CALLBACK_TUTORIAL).not.toMatch(/import Glitch|from ['"]glitch-javascript-sdk/);
    expect(MICROTRANSACTION_CALLBACK_TUTORIAL).toContain("No npm package, SDK import or SDK version is required");
  });

  it("opens anonymous in-game checkout with exact Origin binding and preserves the game", async () => {
    const f = fixture(); await f.open();
    expect(f.calls.map(call => call.url.pathname.split("/").at(-1))).toEqual(["catalog", "checkout-sessions"]);
    const call = f.calls[1]!;
    expect(call.body).toMatchObject({ product_id: productId, quantity: 1, return_origin: f.win.location.origin, channel: "web", environment: "sandbox" });
    expect(call.body.nonce).toMatch(/^[a-f0-9]{64}$/);
    for (const { init, url } of f.calls) {
      expect(init.credentials).toBe("omit"); expect(init.redirect).toBe("error");
      expect(new Headers(init.headers).has("Authorization")).toBe(false);
      expect(new Headers(init.headers).has("Origin")).toBe(false);
      expect(url.searchParams.has("community_id")).toBe(false);
    }
    expect(f.frame().attrs.sandbox).not.toContain("top-navigation");
    expect(f.frame().attrs.allow).toBe("payment");
    expect(f.paused).toBe(1); expect(f.applied).toEqual([]);
    expect(f.canvas.isConnected).toBe(true); expect(f.win.location.href).toBe("https://game.example.test/playing");
    f.shop.destroy(); expect(f.timers.size).toBe(0);
  });

  it("rejects wrong origin/source/title/session/nonce/version without redeeming a code", async () => {
    const f = fixture(); await f.open();
    await f.message({}, { origin: "https://evil.example.test" }); await f.message({}, { source: {} });
    for (const patch of [{ title_id: restoreId }, { checkout_session_id: restoreId }, { nonce: "wrong" }, { version: 2 }]) await f.message(patch);
    expect(f.calls).toHaveLength(2); expect(f.applied).toEqual([]); f.shop.destroy();
  });

  it("exchanges once, checks the actual receipt DTO without mandatory player_id, and replaces inventory", async () => {
    const f = fixture(); await f.open(); await f.message(); await f.message();
    expect(f.calls.filter(call => call.url.pathname.endsWith("/handoffs/claim"))).toHaveLength(1);
    const exchange = f.calls.find(call => call.url.pathname.endsWith("/handoffs/claim"))!;
    expect(exchange.body).toMatchObject({ checkout_session_id: sessionId, return_origin: f.win.location.origin });
    expect(new Headers(exchange.init.headers).has("Authorization")).toBe(false);
    expect(f.applied[0]).toEqual({ playerId, entitlements: [{ key: "timber", kind: "consumable", balance: 100, environment: "sandbox" }] });
    expect(f.calls.some(call => call.url.pathname.endsWith("/consume"))).toBe(false);
    expect(f.saved.size).toBe(0);
    f.setBalance(45); await f.click("Close and return to game");
    expect(f.applied.at(-1).entitlements[0].balance).toBe(45);
    expect(f.resumed).toBe(1); expect(f.doc.activeElement).toBe(f.canvas);
    expect(f.canvas.textContent).toBe("unchanged-game-score:20"); f.shop.destroy();
  });

  it.each(["expired_claim", "wrong_title", "wrong_order", "not_paid", "wrong_environment", "optional_wrong_player"])("fails closed for %s", async reason => {
    const f = fixture(); await f.open();
    if (reason === "expired_claim") f.claim.expires_at = new Date(Date.now() - 1).toISOString();
    if (reason === "wrong_title") f.claim.title_id = restoreId;
    if (reason === "wrong_order") f.order.id = restoreId;
    if (reason === "not_paid") f.order.payment_status = "action_required";
    if (reason === "wrong_environment") f.order.environment = "live";
    if (reason === "optional_wrong_player") f.order.player_id = restoreId;
    await f.message(); expect(f.applied).toEqual([]); f.shop.destroy();
  });

  it("keeps the overlay until in-flight claim and authoritative callback finish", async () => {
    const f = fixture(); await f.open();
    let release!: (response: any) => void;
    f.handle(url => url.pathname.endsWith("/handoffs/claim") ? new Promise(resolve => { release = resolve; }) : undefined);
    await f.message(); await f.click("Close and return to game");
    expect(f.frame()).toBeDefined(); expect(f.resumed).toBe(0);
    release({ ok: true, status: 200, json: async () => ({ data: f.claim }) });
    await flush(); expect(f.applied.length).toBeGreaterThan(0); expect(f.frame()).toBeUndefined(); expect(f.resumed).toBe(1); f.shop.destroy();
  });

  it("uses the same session on watchdog retry and does not mistake ready for payment", async () => {
    const f = fixture(); await f.open(); f.fireWatchdog();
    expect(f.text()).toContain("did not become ready");
    await f.click("Reload SAME checkout"); expect(f.frame().src).toBe("about:blank");
    f.frame().emit("load"); expect(f.frame().src).toContain("/checkout/" + sessionId + "#token=");
    f.frame().emit("load");
    await f.message({ type: "glitch.microtransaction.ready" });
    expect(f.applied).toEqual([]); expect(f.calls).toHaveLength(2); expect(f.timers.size).toBe(0); f.shop.destroy();
  });

  it("clears the watchdog after verified inventory even when the ready message was lost", async () => {
    const f = fixture(); await f.open();
    expect(f.timers.size).toBe(1);
    await f.message();
    expect(f.applied).toHaveLength(1); expect(f.timers.size).toBe(0);
    f.fireWatchdog(); expect(f.text()).not.toContain("did not become ready");
    expect(f.canvas.isConnected).toBe(true); f.shop.destroy();
  });

  it("retains a consumption action across uncertain response and replaces balance after retry", async () => {
    const f = fixture(); await f.open(); await f.message(); await f.click("Close and return to game");
    let attempts = 0;
    f.handle(url => { if (url.pathname.endsWith("/consume") && ++attempts === 1) return Promise.reject(new Error("connection lost")); });
    await f.click("Use 1 unit of timber"); f.setBalance(99); await f.click("Use 1 unit of timber");
    const consumes = f.calls.filter(call => call.url.pathname.endsWith("/consume"));
    expect(consumes).toHaveLength(2); expect(consumes[1]!.body).toEqual(consumes[0]!.body);
    expect(new Headers(consumes[1]!.init.headers).get("Authorization")).toBe("Bearer " + playerToken);
    expect(f.applied.at(-1).entitlements[0].balance).toBe(99);
    expect([...f.saved.values()].join("")).not.toContain(playerToken); f.shop.destroy();
  });

  it("retains the same consumption intent after acknowledged use but failed inventory refresh", async () => {
    const f = fixture(); await f.open(); await f.message(); await f.click("Close and return to game");
    let reads = 0;
    f.handle(url => url.pathname.endsWith("/entitlements") && ++reads === 1 ? Promise.reject(new Error("refresh unavailable")) : undefined);
    f.setBalance(99); await f.click("Use 1 unit of timber");
    expect(f.saved.size).toBe(1); expect(f.button("Use 1 unit of timber").disabled).toBe(true);
    await f.click("Refresh inventory / payment status"); await f.click("Use 1 unit of timber");
    const calls = f.calls.filter(call => call.url.pathname.endsWith("/consume"));
    expect(calls).toHaveLength(2); expect(calls[1]!.body).toEqual(calls[0]!.body);
    expect(f.saved.size).toBe(0); expect(f.applied.at(-1).entitlements[0].balance).toBe(99); f.shop.destroy();
  });

  it("does not replay a one-use code after a lost response", async () => {
    const f = fixture(); await f.open();
    f.handle(url => url.pathname.endsWith("/handoffs/claim") ? Promise.reject(new Error("lost reply")) : undefined);
    await f.message(); await f.message();
    expect(f.calls.filter(call => call.url.pathname.endsWith("/handoffs/claim"))).toHaveLength(1);
    expect(f.applied).toEqual([]); expect(f.text()).toContain("fresh code"); f.shop.destroy();
  });

  it("shows no-purchases restore errors without generating a payment", async () => {
    const f = fixture();
    f.handle(url => url.pathname.endsWith("/restore-sessions") ? { ok: false, status: 409,
      json: async () => ({ code: "no_purchases_to_restore" }) } : undefined);
    await f.open(true);
    expect(f.text()).toContain("No completed purchases to restore");
    expect(f.frame()).toBeUndefined(); expect(f.applied).toEqual([]);
    expect(f.calls.some(call => call.url.pathname.endsWith("/checkout-sessions"))).toBe(false); f.shop.destroy();
  });

  it.each([undefined, null, "", "a".repeat(101), " timber", "timber/wood", "timber\n", "timbér"])("rejects an invalid explicit spendKey %s", key => {
    expect(() => fixture({ spendKey: key })).toThrow("Invalid commerce configuration");
  });

  it("does not consume durable ownership and reads nullable historical products without granting", async () => {
    const f = fixture(); f.setKind("durable"); f.setBalance(1);
    await f.open(); await f.message(); await f.click("Close and return to game");
    expect(f.button("Use 1 unit of timber").disabled).toBe(true);
    await f.click("List my purchases (optional)");
    const history = f.calls.find(call => call.url.pathname.endsWith("/me/purchases"))!;
    expect([...history.url.searchParams.keys()].sort()).toEqual(["environment", "page", "per_page"]);
    expect(f.text()).toContain("Archived item"); expect(f.calls.some(call => call.url.pathname.endsWith("/consume"))).toBe(false); f.shop.destroy();
  });

  it("uses anonymous restore ingress with its own pinned session and never a new charge", async () => {
    const f = fixture(); await f.open(true);
    expect(f.calls[1]!.url.pathname).toMatch(/\/restore-sessions$/);
    expect(f.calls[1]!.body).toEqual({ environment: "sandbox", return_origin: f.win.location.origin, nonce: expect.any(String) });
    f.claim.checkout_session_id = restoreId;
    await f.message({ checkout_session_id: sessionId }); expect(f.applied).toEqual([]);
    await f.message({ checkout_session_id: restoreId }); expect(f.applied).toHaveLength(1);
    expect(f.calls.some(call => call.url.pathname.endsWith("/checkout-sessions") || call.url.pathname.endsWith("/checkout"))).toBe(false); f.shop.destroy();
  });
});
