import { describe, expect, it } from "vitest";
import { parseSseStream, type SseMessage } from "../src/sse.js";

function sseResponse(text: string): Response {
  return new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("parseSseStream", () => {
  it("parses events, JSON data, and ignores comments/heartbeats", async () => {
    const text =
      "event: status\ndata: {\"status\":\"running\"}\n\n" +
      "event: run_event\ndata: {\"message\":\"Analyzing Steam page\"}\n\n" +
      ": heartbeat-comment\n\n" +
      "event: settled\ndata: {\"id\":\"run_1\",\"status\":\"completed\"}\n\n";

    const messages: SseMessage[] = [];
    await parseSseStream(sseResponse(text), (message) => {
      messages.push(message);
    });

    expect(messages.map((m) => m.event)).toEqual(["status", "run_event", "settled"]);
    expect(messages[1]?.data.message).toBe("Analyzing Steam page");
    expect(messages[2]?.data.status).toBe("completed");
  });

  it("supports multi-line data and non-JSON payloads", async () => {
    const text = "event: note\ndata: line one\ndata: line two\n\n";
    const messages: SseMessage[] = [];
    await parseSseStream(sseResponse(text), (m) => void messages.push(m));

    expect(messages).toHaveLength(1);
    expect(messages[0]?.data.raw).toBe("line one\nline two");
  });

  it("stops early when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const messages: SseMessage[] = [];
    await parseSseStream(sseResponse("event: x\ndata: {}\n\n"), (m) => void messages.push(m), controller.signal);
    expect(messages).toHaveLength(0);
  });
});
