import { describe, expect, it, vi } from "vitest";
import { GlitchClient, isRunSettled, runIsSettled } from "../src/glitchClient.js";
import { createFetchMock, expectAuthorization, jsonResponse } from "./helpers.js";

const config = {
  apiBaseUrl: "https://mcp.example.test",
  dashboardBaseUrl: "https://app.example.test",
  timeoutMs: 1000,
  clientName: "test-client"
};

describe("GlitchClient", () => {
  it("requires a title when no selected/default title exists", () => {
    const client = new GlitchClient(config);

    expect(() => client.resolveTitleId()).toThrow("A game title is required");
  });

  it("uses configured default title id", () => {
    const client = new GlitchClient({ ...config, defaultTitleId: "title_default" });

    expect(client.resolveTitleId()).toBe("title_default");
  });

  it("verifies and stores selected title context", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: { id: "title_1", name: "Example Game" } }));
    const client = new GlitchClient(config, mock.fetch);

    const result = await client.selectTitle("title_1");

    expect(client.resolveTitleId()).toBe("title_1");
    expect(result).toEqual({
      selected_title_id: "title_1",
      context: { id: "title_1", name: "Example Game" }
    });
    expect(mock.requests[0]?.url).toBe("https://mcp.example.test/mcp/v1/titles/title_1/context");
  });

  it("polls runs until a settled status is returned", async () => {
    vi.useFakeTimers();
    const mock = createFetchMock((_request, index) =>
      jsonResponse({
        data: index === 0 ? { id: "run_1", status: "running" } : { id: "run_1", status: "completed" }
      })
    );
    const client = new GlitchClient(config, mock.fetch);

    const promise = client.waitForRun("title_1", "run_1", 5000, 100);
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(result).toEqual({
      timed_out: false,
      run: { id: "run_1", status: "completed" }
    });
    expect(mock.requests).toHaveLength(2);
    vi.useRealTimers();
  });

  it("returns a timeout envelope with the last run", async () => {
    vi.useFakeTimers();
    const mock = createFetchMock(() => jsonResponse({ data: { id: "run_1", status: "running" } }));
    const client = new GlitchClient(config, mock.fetch);

    const promise = client.waitForRun("title_1", "run_1", 50, 25);
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(result.timed_out).toBe(true);
    expect(result.run).toEqual({ id: "run_1", status: "running" });
    vi.useRealTimers();
  });

  it("recognizes terminal and paused-for-user statuses aligned with the backend", () => {
    expect(isRunSettled("completed")).toBe(true);
    expect(isRunSettled("needs_guidance")).toBe(true);
    expect(isRunSettled("needs_approval")).toBe(true);
    // Previously missed states that left wait loops spinning until timeout.
    expect(isRunSettled("stopped")).toBe(true);
    expect(isRunSettled("waiting")).toBe(true);
    expect(isRunSettled("paused")).toBe(true);
    expect(isRunSettled("CANCELED")).toBe(true);
    expect(isRunSettled("running")).toBe(false);
    expect(isRunSettled("queued")).toBe(false);
  });

  it("prefers the backend is_settled flag over the status string", () => {
    // Authoritative flag wins even for an unknown status string.
    expect(runIsSettled({ status: "some_new_status", is_settled: true })).toBe(true);
    expect(runIsSettled({ status: "completed", is_settled: false })).toBe(false);
    // is_terminal/is_paused are honored when is_settled is absent.
    expect(runIsSettled({ status: "running", is_paused: true })).toBe(true);
    // Falls back to the status list for older backends with no flags.
    expect(runIsSettled({ status: "needs_approval" })).toBe(true);
    expect(runIsSettled({ status: "running" })).toBe(false);
  });

  it("stops waiting when only the is_settled flag (not the status) marks completion", async () => {
    vi.useFakeTimers();
    const mock = createFetchMock((_request, index) =>
      jsonResponse({
        data:
          index === 0
            ? { id: "run_1", status: "running", is_settled: false }
            : { id: "run_1", status: "frobnicating", is_settled: true }
      })
    );
    const client = new GlitchClient(config, mock.fetch);

    const promise = client.waitForRun("title_1", "run_1", 5000, 100);
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(result.timed_out).toBe(false);
    expect(mock.requests).toHaveLength(2);
    vi.useRealTimers();
  });

  it("forwards a per-request auth token to the hosted service, overriding config.token", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: { id: "title_1" } }));
    const client = new GlitchClient(
      { ...config, token: "config-token" },
      mock.fetch,
      undefined,
      { authToken: "per-request-token" }
    );

    await client.titleContext("title_1");

    expectAuthorization(mock.requests[0]?.init, "per-request-token");
  });

  it("falls back to the configured token when no per-request token is given", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: { id: "title_1" } }));
    const client = new GlitchClient({ ...config, token: "config-token" }, mock.fetch);

    await client.titleContext("title_1");

    expectAuthorization(mock.requests[0]?.init, "config-token");
  });
});
