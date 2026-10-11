import { describe, expect, it } from "vitest";
import { GlitchClient } from "../src/glitchClient.js";
import { glitchToolDefinitions } from "../src/tools.js";
import {
  analyzeCampaignTemplateFields,
  campaignAdditionalPlaceholders,
  campaignEditorPlaceholders
} from "../src/influencerCampaignPlaceholders.js";
import { createFetchMock, jsonResponse } from "./helpers.js";

const expected = {
  influencer: ["first_name", "dynamic_name", "instagram_username", "tiktok_username",
    "youtube_channel", "twitch_username", "twitter_username", "bluesky_username",
    "facebook_username", "reddit_username"],
  campaign: ["campaign_name", "campaign_description", "campaign_objective",
    "campaign_deliverables", "campaign_days_to_complete", "campaign_late_penalty_percentage",
    "campaign_spend_limit_per_influencer", "campaign_start_date", "campaign_end_date", "campaign_link"],
  game: ["game_title", "game_short_description", "game_long_description", "game_pricing",
    "game_publisher", "game_developer", "game_steam_url", "game_itch_url", "game_iphone_url",
    "game_android_url", "game_website_url"],
  keys: ["access_key"]
};

describe("Influencer campaign placeholders", () => {
  it("exposes all 32 exact placeholders displayed in the outreach editor", () => {
    const groups = Object.keys(expected) as Array<keyof typeof expected>;
    for (const group of groups) {
      expect(campaignEditorPlaceholders.filter((p) => p.group === group).map((p) => p.token))
        .toEqual(expected[group].map((name) => `{{${name}}}`));
    }
    expect(campaignEditorPlaceholders).toHaveLength(32);
    expect(campaignAdditionalPlaceholders.map((p) => p.token)).toEqual([
      "{{campaign_url}}", "{{game_glitch_url}}", "{{game_glitch_play_url}}"
    ]);
  });

  it("preserves supported recipient/campaign placeholders and flags typos across email and social touchpoints", () => {
    const res = analyzeCampaignTemplateFields({
      subject: "Invite {{game_title}} to {{dynamic_name}}",
      email_touch_point_2_html: "<p>{{campaign_link}} / {{access_key}}</p>",
      bluesky_dm_touch_point_3_content: "{{game_steam_url}} {{first-name}}",
      text_version: "Hello {{ first_name }} and {{wrong_variable}}",
      name: "Internal {{not_a_content_field}}"
    });
    expect(res.known).toEqual(expect.arrayContaining([
      "{{game_title}}", "{{dynamic_name}}", "{{campaign_link}}", "{{access_key}}", "{{game_steam_url}}"
    ]));
    expect(res.warnings.map((w) => w.token)).toEqual([
      "{{first-name}}", "{{ first_name }}", "{{wrong_variable}}"
    ]);
  });

  it("delivers readable full catalog and dry-run validation without making network requests", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: {} }));
    const client = new GlitchClient({
      apiBaseUrl: "https://mcp.example.test", dashboardBaseUrl: "https://app.example.test",
      timeoutMs: 1000, clientName: "test-client"
    }, mock.fetch);
    const operation = glitchToolDefinitions.find((x) => x.name === "glitch_influencer_campaign_operation");
    expect(operation).toBeDefined();
    const listing = await operation!.handler(client, { operation: "placeholders.list" });
    expect(JSON.stringify(listing.structuredContent)).toContain("{{bluesky_username}}");
    expect(JSON.stringify(listing.structuredContent)).toContain("{{access_key}}");
    expect(listing.content[0]?.text).toContain("{{game_title}}");
    expect(listing.content[0]?.text).toContain("Title.name");
    const validation = await operation!.handler(client, {
      operation: "templates.validate", fields: {
        subject: "Hello {{dynamic_name}}, play {{game_title}}",
        email_touch_point_2_text: "No key yet: {{access_key}} or {{wrong}}"
      }
    });
    expect(JSON.stringify(validation.structuredContent)).toContain("{{wrong}}");
    expect(validation.content[0]?.text).toContain("{{wrong}}");
    expect(mock.requests).toHaveLength(0);
  });

  it("reports unknown placeholders on mutations without modifying or blocking message delivery", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: { template: { id: "template-1" } } }));
    const client = new GlitchClient({
      apiBaseUrl: "https://mcp.example.test", dashboardBaseUrl: "https://app.example.test",
      timeoutMs: 1000, clientName: "test-client",
      defaultTitleId: "b7614555-f88b-4c55-a296-1376c08c4d24"
    }, mock.fetch);
    const operation = glitchToolDefinitions.find((x) => x.name === "glitch_influencer_campaign_operation")!;
    const result = await operation.handler(client, {
      operation: "templates.update", confirm: true,
      campaign_id: "5ac4483b-9088-4762-9ab1-9df21a2fc002",
      fields: { subject: "Hi {{typo}} and {{game_title}}" }
    });
    expect(result.isError).toBeUndefined();
    expect(JSON.stringify(result.structuredContent)).toContain("{{typo}}");
    expect(mock.requests[0]?.body).toMatchObject({
      fields: { subject: "Hi {{typo}} and {{game_title}}" }
    });
  });
});
