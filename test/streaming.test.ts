import { describe, expect, it } from "vitest";
import { GlitchClient } from "../src/glitchClient.js";
import { safeTool } from "../src/result.js";
import { glitchToolDefinitions, type ToolRuntimeContext } from "../src/tools.js";
import { createFetchMock, jsonResponse } from "./helpers.js";

const config = {
  apiBaseUrl: "https://mcp.example.test",
  dashboardBaseUrl: "https://app.example.test",
  timeoutMs: 1000,
  clientName: "test-client",
  defaultTitleId: "title_default"
};

function sseResponse(text: string): Response {
  return new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const SETTLED_STREAM =
  "event: status\ndata: {\"status\":\"running\"}\n\n" +
  "event: run_event\ndata: {\"message\":\"Drafting launch plan\"}\n\n" +
  "event: settled\ndata: {\"id\":\"run_1\",\"status\":\"completed\",\"is_settled\":true}\n\n";

describe("GlitchClient streaming", () => {
  it("streamRunEvents forwards messages and returns the settled run", async () => {
    const mock = createFetchMock(() => sseResponse(SETTLED_STREAM));
    const client = new GlitchClient(config, mock.fetch);

    const seen: string[] = [];
    const settled = await client.streamRunEvents("title_1", "run_1", {
      onMessage: (m) => void seen.push(m.event)
    });

    expect(mock.requests[0]?.url).toBe("https://mcp.example.test/mcp/v1/titles/title_1/runs/run_1/stream");
    expect(seen).toEqual(["status", "run_event", "settled"]);
    expect(settled).toMatchObject({ id: "run_1", status: "completed" });
  });

  it("waitForRunStreaming resolves from the stream without polling", async () => {
    const mock = createFetchMock(() => sseResponse(SETTLED_STREAM));
    const client = new GlitchClient(config, mock.fetch);

    const result = await client.waitForRunStreaming("title_1", "run_1", {
      timeoutMs: 5000,
      pollIntervalMs: 100
    });

    expect(result).toEqual({ timed_out: false, run: { id: "run_1", status: "completed", is_settled: true } });
    expect(mock.requests).toHaveLength(1); // only the stream, no polling
  });

  it("falls back to polling when the stream endpoint is unavailable", async () => {
    const mock = createFetchMock((request) => {
      if (request.url.includes("/stream")) {
        return jsonResponse({ message: "Not found." }, 404);
      }
      return jsonResponse({ data: { id: "run_1", status: "completed" } });
    });
    const client = new GlitchClient(config, mock.fetch);

    const result = await client.waitForRunStreaming("title_1", "run_1", { timeoutMs: 5000, pollIntervalMs: 50 });

    expect(result).toEqual({ timed_out: false, run: { id: "run_1", status: "completed" } });
    expect(mock.requests.map((r) => r.url)).toEqual([
      "https://mcp.example.test/mcp/v1/titles/title_1/runs/run_1/stream",
      "https://mcp.example.test/mcp/v1/titles/title_1/runs/run_1"
    ]);
  });
});

describe("glitch_wait_for_agent_run streaming", () => {
  it("emits progress and log notifications while streaming, then returns settled", async () => {
    const mock = createFetchMock(() => sseResponse(SETTLED_STREAM));
    const client = new GlitchClient(config, mock.fetch);

    const logs: string[] = [];
    const progress: Array<{ progress: number; message?: string }> = [];
    const ctx: ToolRuntimeContext = {
      streamingEnabled: true,
      async log(_level, message) {
        logs.push(message);
      },
      async progress(value, _total, message) {
        progress.push({ progress: value, ...(message ? { message } : {}) });
      }
    };

    const definition = glitchToolDefinitions.find((tool) => tool.name === "glitch_wait_for_agent_run");
    const result = await safeTool(() => definition!.handler(client, { run_id: "run_1", stream: true }, ctx));

    expect(result.isError).toBeUndefined();
    expect(logs.some((line) => line.includes("Drafting launch plan"))).toBe(true);
    expect(progress.length).toBeGreaterThanOrEqual(1);
    expect(result.structuredContent?.data).toMatchObject({ timed_out: false });
  });

  it("uses polling (no stream) when the client cannot receive notifications", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: { id: "run_1", status: "completed" } }));
    const client = new GlitchClient(config, mock.fetch);

    const definition = glitchToolDefinitions.find((tool) => tool.name === "glitch_wait_for_agent_run");
    const ctx: ToolRuntimeContext = {
      streamingEnabled: false,
      async log() {},
      async progress() {}
    };
    const result = await safeTool(() => definition!.handler(client, { run_id: "run_1", stream: true }, ctx));

    expect(result.isError).toBeUndefined();
    // Polled the run endpoint, never opened the stream.
    expect(mock.requests[0]?.url).toBe("https://mcp.example.test/mcp/v1/titles/title_default/runs/run_1");
  });
});
