import { describe, expect, it } from "vitest";
import { GlitchClient } from "../src/glitchClient.js";
import { campaignGameSourcingToolDefinitions } from "../src/campaignGameSourcingTools.js";
import { createFetchMock, jsonResponse } from "./helpers.js";

const title = "3ccaceab-447c-4d5a-8b65-c9edafdfd5dd";
const campaign = "2ccaceab-447c-4d5a-8b65-c9edafdfd5dd";
const version = "a".repeat(64);
const config = { apiBaseUrl: "https://example.test", dashboardBaseUrl: "https://example.test",
  timeoutMs: 1000, clientName: "campaign-test", defaultTitleId: title };
const research = campaignGameSourcingToolDefinitions.find(x => x.name === "glitch_research_campaign_lookalike_games")!;
const assign = campaignGameSourcingToolDefinitions.find(x => x.name === "glitch_assign_campaign_lookalike_games")!;

describe("campaign game and Twitch sourcing MCP", () => {
  it("registers discoverable, independent read and write tools", () => {
    expect(research.readOnlyHint).toBe(true);
    expect(assign.readOnlyHint).toBe(false);
    expect(assign.destructiveHint).toBe(true);
    expect(research.description).toContain("seven days");
    expect(assign.description).toContain("automatic invitations");
  });

  it("forwards search, recent and live research through the title-scoped JSON API with no mutation", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: { games: [{ id: 239, name: "Mech Game" }],
      selection_version: version } }));
    const client = new GlitchClient(config, mock.fetch);
    for (const input of [
      { operation: "settings", campaign_id: campaign },
      { operation: "search", campaign_id: campaign, query: "city builder", limit: 15 },
      { operation: "similar", campaign_id: campaign, igdb_id: 239, limit: 20 },
      { operation: "active-lookalikes", campaign_id: campaign, igdb_id: 239, limit: 25 },
      { operation: "live-streams", campaign_id: campaign, igdb_ids: [239, 445], limit: 20 },
    ]) {
      const result = await research.handler(client, input);
      expect(result.isError).toBeUndefined();
      expect(JSON.stringify(result.structuredContent)).toContain("Mech Game");
    }
    expect(mock.requests).toHaveLength(5);
    expect(mock.requests.every(req => req.init?.method === "POST")).toBe(true);
    expect(mock.requests.map(req => req.url.split("/").at(-1))).toEqual([
      "sourcing.settings", "sourcing.search", "sourcing.similar", "sourcing.active-lookalikes", "sourcing.live-streams"
    ]);
    expect(mock.requests[4]?.body).toMatchObject({ campaign_id: campaign, igdb_ids: [239, 445] });
    expect(mock.requests.every(req => req.url.includes(title))).toBe(true);
  });

  it("will not assign without explicit confirmation, version and game IDs", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: { saved: true } }));
    const client = new GlitchClient(config, mock.fetch);
    await expect(assign.handler(client, {
      campaign_id: campaign, igdb_ids: [239], expected_version: version
    })).rejects.toThrow("confirm=true");
    await expect(assign.handler(client, {
      campaign_id: campaign, igdb_ids: [], expected_version: version, confirm: true
    })).rejects.toThrow();
    await expect(assign.handler(client, {
      campaign_id: campaign, igdb_ids: [239], expected_version: "bad", confirm: true
    })).rejects.toThrow();
    await expect(research.handler(client, { operation: "live-streams", campaign_id: campaign }))
      .rejects.toThrow("requires igdb_ids");
    expect(mock.requests).toHaveLength(0);
  });

  it("passes deliberate outreach-impact acknowledgement and exact selection version", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: {
      saved: true, settings: { similar_game_igdb_ids: [239, 445] }
    } }));
    const client = new GlitchClient(config, mock.fetch);
    const result = await assign.handler(client, {
      campaign_id: campaign, igdb_ids: [239, 445],
      expected_version: version, confirm: true, confirm_outreach_impact: true
    });
    expect(result.isError).toBeUndefined();
    expect(mock.requests[0]?.url).toContain("sourcing.assign-lookalikes");
    expect(mock.requests[0]?.init?.method).toBe("POST");
    expect(mock.requests[0]?.body).toMatchObject({
      campaign_id: campaign,
      igdb_ids: [239, 445],
      expected_version: version,
      confirm: true,
      confirm_outreach_impact: true
    });
  });
});
