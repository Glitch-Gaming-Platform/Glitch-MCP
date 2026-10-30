import { describe, it, expect, vi } from "vitest";
import { verifyHttpCaller } from "../src/server.js";
import type { GlitchMcpConfig } from "../src/config.js";

const config: GlitchMcpConfig = {
  apiBaseUrl: "https://api.glitch.fun/api",
  dashboardBaseUrl: "https://www.glitch.fun",
  timeoutMs: 30000, clientName: "remote-test"
};

describe("public MCP caller verification", () => {
  it("accepts authenticated users and forwards only their bearer", async () => {
    const fetchFn = vi.fn().mockImplementation(async () => new Response(
      JSON.stringify({ data: { authenticated: true } }), { status: 200 }
    ));
    expect(await verifyHttpCaller(config, "user-one", fetchFn)).toBe(true);
    expect(fetchFn).toHaveBeenCalledWith("https://api.glitch.fun/api/mcp/v1/auth/status", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer user-one" })
    }));
    expect(await verifyHttpCaller(config, "user-two", fetchFn)).toBe(true);
    expect(fetchFn.mock.calls[1][1].headers.Authorization).toBe("Bearer user-two");
  });

  it("rejects missing, invalid, anonymous or unreachable upstream credentials", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ data: { authenticated: false } }), { status: 200 }
    ));
    expect(await verifyHttpCaller(config, "", fetchFn)).toBe(false);
    expect(await verifyHttpCaller(config, "x".repeat(8193), fetchFn)).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(await verifyHttpCaller(config, "bad", fetchFn)).toBe(false);
    fetchFn.mockResolvedValue(new Response("{}", { status: 401 }));
    expect(await verifyHttpCaller(config, "revoked", fetchFn)).toBe(false);
    fetchFn.mockRejectedValue(new Error("network down"));
    expect(await verifyHttpCaller(config, "network", fetchFn)).toBe(false);
  });
});
