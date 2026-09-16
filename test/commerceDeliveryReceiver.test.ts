import { generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const node24Example = Number.parseInt(process.versions.node.split(".")[0] || "0", 10) >= 24;
describe.skipIf(!node24Example)("standalone Ed25519 receiver example requires Node24+; core MCP remains Node20 compatible", () => {
  it.skipIf(!existsSync(new URL("../../glitch-myrriame/guides/commerce-delivery-receiver.mjs", import.meta.url)))("ships the same reviewed receiver in sibling SDK guides and MCP examples", () => {
    expect(readFileSync(new URL("../examples/commerce-delivery-receiver.mjs", import.meta.url), "utf8"))
      .toBe(readFileSync(new URL("../../glitch-myrriame/guides/commerce-delivery-receiver.mjs", import.meta.url), "utf8"));
  });

  it("verifies exact signed bytes and durably deduplicates without applying stale inventory snapshots", async () => {
    const { createDeliveryInbox } = await import(new URL("../examples/commerce-delivery-receiver.mjs", import.meta.url).href);
    const directory = mkdtempSync(join(tmpdir(), "glitch-delivery-example-"));
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const titleId = "10000000-0000-4000-8000-000000000001";
    const keyId = "10000000-0000-4000-8000-000000000002";
    const event = { id: "10000000-0000-4000-8000-000000000003", type: "purchase.granted", title_id: titleId, environment: "sandbox", order_version: 1,
      authoritative_order: { id: "10000000-0000-4000-8000-000000000004", title_id: titleId, environment: "sandbox" }, entitlements: [{ key: "gold", balance: 100 }] };
    const config = { titleId, environment: "sandbox", keyId, publicKeyBase64: publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64"), databasePath: join(directory, "inbox.sqlite") };
    const timestamp = Math.floor(Date.now() / 1000);
    const envelope = (body: unknown = event, ts = timestamp) => {
      const raw = Buffer.from(JSON.stringify(body));
      return { raw, headers: { "X-Glitch-Signature-Algorithm": "ed25519", "X-Glitch-Key-Id": keyId, "X-Glitch-Timestamp": String(ts), "X-Glitch-Event-Id": event.id,
        "X-Glitch-Signature": sign(null, Buffer.concat([Buffer.from(String(ts) + "."), raw]), privateKey).toString("base64") } };
    };
    let inbox = createDeliveryInbox(config);
    try {
      const first = envelope();
      expect(inbox.receive(first.headers, first.raw, timestamp)).toEqual({ event_id: event.id, duplicate: false });
      inbox.close(); inbox = createDeliveryInbox(config);
      const retry = envelope({ ...event, order_version: 2, entitlements: [{ key: "gold", balance: 50 }] });
      expect(inbox.receive(retry.headers, retry.raw, timestamp)).toEqual({ event_id: event.id, duplicate: true });
      expect(() => inbox.receive(first.headers, Buffer.concat([first.raw, Buffer.from(" ")]), timestamp)).toThrow("invalid_signature");
      expect(() => inbox.receive({ ...first.headers, "X-Glitch-Key-Id": "message-selected-key" }, first.raw, timestamp)).toThrow("unexpected_signing_key");
      expect(() => inbox.receive({ ...first.headers, "X-Glitch-Signature-Algorithm": "hmac-sha256" }, first.raw, timestamp)).toThrow("unexpected_signing_key");
      expect(() => inbox.receive({ ...first.headers, "X-Glitch-Event-Id": "wrong-event" }, first.raw, timestamp)).toThrow("event_scope_mismatch");
      const expired = envelope(event, timestamp - 301);
      expect(() => inbox.receive(expired.headers, expired.raw, timestamp)).toThrow("expired_timestamp");
      const otherTitle = envelope({ ...event, title_id: "other-title" });
      expect(() => inbox.receive(otherTitle.headers, otherTitle.raw, timestamp)).toThrow("event_scope_mismatch");
      const otherEnvironment = envelope({ ...event, environment: "live" });
      expect(() => inbox.receive(otherEnvironment.headers, otherEnvironment.raw, timestamp)).toThrow("event_scope_mismatch");
      const future = envelope(event, timestamp + 301);
      expect(() => inbox.receive(future.headers, future.raw, timestamp)).toThrow("expired_timestamp");
      const otherOrder = envelope({ ...event, authoritative_order: { ...event.authoritative_order, id: keyId } });
      expect(() => inbox.receive(otherOrder.headers, otherOrder.raw, timestamp)).toThrow("event_identity_conflict");
      const otherType = envelope({ ...event, type: "purchase.revoked" });
      expect(() => inbox.receive(otherType.headers, otherType.raw, timestamp)).toThrow("event_identity_conflict");
      expect(() => inbox.receive({ ...first.headers, "X-Glitch-Signature": "not-base64" }, first.raw, timestamp)).toThrow("invalid_base64");
      expect(() => inbox.receive(first.headers, Buffer.alloc(1048577), timestamp)).toThrow("invalid_body_size");
      expect(inbox.receive(first.headers, first.raw, timestamp).duplicate).toBe(true); // A rejected conflict did not poison the transaction.
    } finally { inbox.close(); rmSync(directory, { recursive: true, force: true }); }
  });

  it("acknowledges real HTTP notifications only after a durable commit and fails closed on storage errors", async () => {
    const { createDeliveryInbox, createDeliveryServer } = await import(new URL("../examples/commerce-delivery-receiver.mjs", import.meta.url).href);
    const directory = mkdtempSync(join(tmpdir(), "glitch-delivery-http-"));
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const titleId = "10000000-0000-4000-8000-000000000011";
    const keyId = "10000000-0000-4000-8000-000000000012";
    const eventId = "10000000-0000-4000-8000-000000000013";
    const inbox = createDeliveryInbox({ titleId, environment: "sandbox", keyId,
      publicKeyBase64: publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64"), databasePath: join(directory, "inbox.sqlite") });
    let failStorage = false;
    const server = createDeliveryServer({ receive: (...args: unknown[]) => {
      if (failStorage) throw new Error("Private database failure details must never be sent to callers");
      return inbox.receive(...args);
    } });
    try {
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
      const url = `http://127.0.0.1:${server.address().port}/glitch/commerce`;
      const timestamp = String(Math.floor(Date.now() / 1000));
      const raw = JSON.stringify({ id: eventId, type: "purchase.granted", title_id: titleId, environment: "sandbox", order_version: 1,
        authoritative_order: { id: "10000000-0000-4000-8000-000000000014", title_id: titleId, environment: "sandbox" } });
      const headers = { "Content-Type": "application/json", "X-Glitch-Signature-Algorithm": "ed25519", "X-Glitch-Key-Id": keyId,
        "X-Glitch-Timestamp": timestamp, "X-Glitch-Event-Id": eventId, "X-Glitch-Signature": sign(null, Buffer.from(timestamp + "." + raw), privateKey).toString("base64") };
      const send = (body = raw) => fetch(url, { method: "POST", headers, body });
      const first = await send();
      expect(first.status).toBe(200);
      expect(first.headers.get("cache-control")).toBe("no-store");
      expect(await first.json()).toEqual({ event_id: eventId, duplicate: false });
      expect(await (await send()).json()).toEqual({ event_id: eventId, duplicate: true });
      expect((await send(raw + " ")).status).toBe(401);
      expect((await fetch(url)).status).toBe(404);
      failStorage = true;
      const failed = await send();
      expect(failed.status).toBe(500);
      expect(await failed.json()).toEqual({ error: "delivery_handling_failed" });
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      inbox.close(); rmSync(directory, { recursive: true, force: true });
    }
  });
});
