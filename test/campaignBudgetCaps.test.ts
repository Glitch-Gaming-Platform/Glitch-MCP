import { describe, expect, it } from "vitest";
import { GlitchClient } from "../src/glitchClient.js";
import { campaignBudgetToolDefinitions } from "../src/campaignBudgetTools.js";
import { createFetchMock, jsonResponse } from "./helpers.js";

const title = "3ccaceab-447c-4d5a-8b65-c9edafdfd5dd";
const campaign = "2ccaceab-447c-4d5a-8b65-c9edafdfd5dd";
const version = "f".repeat(64);
const config = { apiBaseUrl: "https://example.test", dashboardBaseUrl: "https://example.test",
  timeoutMs: 1000, clientName: "budget-test", defaultTitleId: title };
const get = campaignBudgetToolDefinitions.find(x => x.name === "glitch_get_campaign_budget_caps")!;
const update = campaignBudgetToolDefinitions.find(x => x.name === "glitch_update_campaign_budget_caps")!;

describe("campaign budget caps tools", () => {
  it("exposes read-only budget inspection through title-scoped MCP", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: { enrichment_spend_cap_usd: 300,
      email_send_spend_cap_usd: 250, budget_version: version, spend_cap_status: { metrics: {} } } }));
    const client = new GlitchClient(config, mock.fetch);
    const res = await get.handler(client, { campaign_id: campaign });
    expect(get.readOnlyHint).toBe(true);
    expect(res.isError).toBeUndefined();
    expect(JSON.stringify(res.structuredContent)).toContain(version);
    expect(mock.requests[0]?.url).toContain("/sourcing.budget.get");
    expect(mock.requests[0]?.init?.method).toBe("POST");
    expect(mock.requests[0]?.body).toMatchObject({ campaign_id: campaign });
  });

  it("requires confirmation, version and valid USD amounts before changing", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: { saved: true } }));
    const client = new GlitchClient(config, mock.fetch);
    await expect(update.handler(client, { campaign_id: campaign, expected_version: version,
      budget_caps: { enrichment_spend_cap_usd: 350 } })).rejects.toThrow("confirm=true");
    await expect(update.handler(client, { campaign_id: campaign, expected_version: "bad", confirm: true,
      budget_caps: { enrichment_spend_cap_usd: 350 } })).rejects.toThrow();
    await expect(update.handler(client, { campaign_id: campaign, expected_version: version, confirm: true,
      budget_caps: { enrichment_spend_cap_usd: -4 } })).rejects.toThrow();
    await expect(update.handler(client, { campaign_id: campaign, expected_version: version, confirm: true,
      budget_caps: { email_send_spend_cap_usd: 4.123 } })).rejects.toThrow();
    await expect(update.handler(client, { campaign_id: campaign, expected_version: version, confirm: true,
      budget_caps: {} })).rejects.toThrow();
    expect(mock.requests).toHaveLength(0);
  });

  it("updates exactly the requested cap and passes the optimistic lock", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: {
      saved: true, budget: { email_send_spend_cap_usd: 125.75 }
    } }));
    const client = new GlitchClient(config, mock.fetch);
    const res = await update.handler(client, { campaign_id: campaign, expected_version: version,
      budget_caps: { email_send_spend_cap_usd: 125.75 }, confirm: true });
    expect(res.isError).toBeUndefined();
    expect(mock.requests[0]?.init?.method).toBe("POST");
    expect(mock.requests[0]?.url).toContain("/sourcing.budget.update");
    expect(mock.requests[0]?.body).toMatchObject({
      campaign_id: campaign,
      budget_version: version,
      budget_caps: { email_send_spend_cap_usd: 125.75 },
      confirm: true
    });
  });
});
