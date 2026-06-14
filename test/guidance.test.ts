import { describe, expect, it, vi } from "vitest";
import { GlitchClient } from "../src/glitchClient.js";
import { safeTool } from "../src/result.js";
import { glitchToolDefinitions, type ElicitOutcome, type ToolRuntimeContext } from "../src/tools.js";
import { createFetchMock, jsonResponse } from "./helpers.js";

const config = {
  apiBaseUrl: "https://mcp.example.test",
  dashboardBaseUrl: "https://app.example.test",
  timeoutMs: 1000,
  clientName: "test-client",
  defaultTitleId: "title_default"
};

const OPEN_GUIDANCE = {
  data: {
    items: [
      {
        id: "guid_1",
        status: "open",
        question: "Which launch date should we target?",
        reason: "The trailer and store page must align.",
        recommended_option: "june",
        options: [
          { value: "june", label: "June 2026" },
          { value: "july", label: "July 2026" }
        ]
      }
    ]
  }
};

function resolveTool() {
  const definition = glitchToolDefinitions.find((tool) => tool.name === "glitch_resolve_guidance");
  if (!definition) {
    throw new Error("missing glitch_resolve_guidance");
  }
  return definition;
}

function ctxWith(canElicit: boolean, elicit: (req: unknown) => Promise<ElicitOutcome>): ToolRuntimeContext {
  return {
    streamingEnabled: false,
    canElicit,
    async log() {},
    async progress() {},
    elicit: elicit as ToolRuntimeContext["elicit"]
  };
}

describe("glitch_resolve_guidance", () => {
  it("presents a multiple-choice prompt and routes the choice back to the agent", async () => {
    const mock = createFetchMock((request) => {
      if ((request.init?.method ?? "GET") === "GET") {
        return jsonResponse(OPEN_GUIDANCE);
      }
      return jsonResponse({ data: { id: "guid_1", status: "answered" } });
    });
    const client = new GlitchClient(config, mock.fetch);

    const elicit = vi.fn(async () => ({ action: "accept", content: { answer: "july", notes: "Avoid June crowding." } }) as ElicitOutcome);
    const result = await safeTool(() => resolveTool().handler(client, {}, ctxWith(true, elicit)));

    // The elicitation prompt offered both options as a multiple-choice enum.
    const promptArg = elicit.mock.calls[0]?.[0] as { message: string; requestedSchema: any };
    expect(promptArg.requestedSchema.properties.answer.enum).toEqual(["june", "july"]);
    expect(promptArg.requestedSchema.properties.answer.enumNames).toEqual(["June 2026", "July 2026"]);
    expect(promptArg.requestedSchema.properties.answer.default).toBe("june");
    expect(promptArg.message).toContain("Which launch date");

    // The answer was routed back to the agent with human-readable + machine values.
    const post = mock.requests.find((r) => (r.init?.method ?? "GET") === "POST");
    expect(post?.url).toBe("https://mcp.example.test/mcp/v1/titles/title_default/guidance/guid_1/answer");
    expect(post?.body).toMatchObject({
      answer: "July 2026",
      selected_option: "july",
      notes: "Avoid June crowding.",
      source: "mcp_elicitation"
    });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent?.data).toMatchObject({ interactive: true });
  });

  it("does not answer when the user declines", async () => {
    const mock = createFetchMock((request) => {
      if ((request.init?.method ?? "GET") === "GET") {
        return jsonResponse(OPEN_GUIDANCE);
      }
      return jsonResponse({ data: {} });
    });
    const client = new GlitchClient(config, mock.fetch);

    const elicit = vi.fn(async () => ({ action: "decline" }) as ElicitOutcome);
    await safeTool(() => resolveTool().handler(client, {}, ctxWith(true, elicit)));

    expect(mock.requests.some((r) => (r.init?.method ?? "GET") === "POST")).toBe(false);
  });

  it("falls back to a readable list when the client cannot show prompts", async () => {
    const mock = createFetchMock(() => jsonResponse(OPEN_GUIDANCE));
    const client = new GlitchClient(config, mock.fetch);

    const elicit = vi.fn(async () => ({ action: "unsupported" }) as ElicitOutcome);
    const result = await safeTool(() => resolveTool().handler(client, {}, ctxWith(false, elicit)));

    expect(elicit).not.toHaveBeenCalled();
    expect(mock.requests.some((r) => (r.init?.method ?? "GET") === "POST")).toBe(false);
    expect(result.structuredContent?.data).toMatchObject({ interactive: false });
    const text = result.content?.[0] as { text: string };
    expect(text.text).toContain("glitch_answer_guidance");
  });

  it("reports when there is no open guidance", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: { items: [] } }));
    const client = new GlitchClient(config, mock.fetch);

    const result = await safeTool(() => resolveTool().handler(client, {}, ctxWith(true, vi.fn())));
    expect(result.structuredContent?.data).toMatchObject({ open_count: 0 });
  });
});
