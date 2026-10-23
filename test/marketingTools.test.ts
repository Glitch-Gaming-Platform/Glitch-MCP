import { describe, expect, it } from "vitest";
import { GlitchClient } from "../src/glitchClient.js";
import { glitchToolDefinitions } from "../src/tools.js";
import { createFetchMock, jsonResponse } from "./helpers.js";

const titleId = "b7614555-f88b-4c55-a296-1376c08c4d24";
const config = {
  apiBaseUrl: "https://mcp.example.test",
  dashboardBaseUrl: "https://app.example.test",
  timeoutMs: 1000,
  clientName: "marketing-test",
  defaultTitleId: titleId
};

describe("Marketing tools", () => {
  it("exposes discoverable advertising and conversion operations using the selected title", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: { operations: [{ name: "campaigns.list" }] } }));
    const client = new GlitchClient(config, mock.fetch);
    const tool = glitchToolDefinitions.find((t) => t.name === "glitch_get_marketing_capabilities");
    expect(tool).toBeDefined();
    const result = await tool!.handler(client, {});
    expect(result.isError).toBeUndefined();
    expect(JSON.stringify(result.structuredContent)).toContain("campaigns.list");
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0]?.url).toContain("/marketing/capabilities");
  });

  it("requires confirmation before any mutating ad or conversion operation", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: {} }));
    const client = new GlitchClient(config, mock.fetch);
    const tool = glitchToolDefinitions.find((t) => t.name === "glitch_marketing_operation")!;
    await expect(tool.handler(client, {
      operation: "campaigns.create", arguments: { fields: { campaign_name: "Test" } }
    })).rejects.toThrow("confirm=true");
    expect(mock.requests).toHaveLength(0);
    const result = await tool.handler(client, { operation: "conversions.status", arguments: { scheduler_id: titleId } });
    expect(result.isError).toBeUndefined();
    expect(mock.requests).toHaveLength(1);
    const write = await tool.handler(client, {
      operation: "campaigns.create", confirm: true,
      arguments: { scheduler_id: titleId, fields: { draft_only: true, campaign_name: "Draft" } }
    });
    expect(write.isError).toBeUndefined();
    expect(mock.requests).toHaveLength(2);
    expect(mock.requests[1]?.url).toContain("/marketing/operations/campaigns.create");
  });
});
