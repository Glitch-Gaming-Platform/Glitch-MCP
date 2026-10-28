import { describe, expect, it } from "vitest";
import { GlitchClient } from "../src/glitchClient.js";
import { influencerCampaignToolDefinitions } from "../src/influencerCampaignTools.js";
import { createFetchMock, jsonResponse } from "./helpers.js";

const titleId = "3ccaceab-447c-4d5a-8b65-c9edafdfd5dd";
const campaignId = "2ccaceab-447c-4d5a-8b65-c9edafdfd5dd";
const replyId = "1ccaceab-447c-4d5a-8b65-c9edafdfd5dd";
const clientMessageId = "9ccaceab-447c-4d5a-8b65-c9edafdfd5dd";
const config = {
    apiBaseUrl: "https://example.test",
    dashboardBaseUrl: "https://example.test",
    timeoutMs: 1000,
    clientName: "reply-tests",
    defaultTitleId: titleId,
};
const tool = influencerCampaignToolDefinitions.find(t => t.name === "glitch_influencer_campaign_operation")!;

describe("tracked influencer email reply MCP", () => {
    it("lists and reads inbox replies without confirmation or side effects", async () => {
        const mock = createFetchMock(() => jsonResponse({ data: { items: [{ id: replyId, subject: "Re: Game" }] } }));
        const client = new GlitchClient(config, mock.fetch);
        const result = await tool.handler(client, { operation: "replies.list", campaign_id: campaignId });
        expect(result.isError).toBeUndefined();
        expect(mock.requests[0]?.init?.method).toBe("GET");
        expect(mock.requests[0]?.url).toContain("replies.list");
        const viewed = await tool.handler(client, { operation: "replies.get", campaign_id: campaignId, reply_id: replyId });
        expect(viewed.isError).toBeUndefined();
        expect(mock.requests[1]?.init?.method).toBe("GET");
        expect(mock.requests[1]?.url).toContain(replyId);
    });
    it("never sends without explicit confirmation, body, reply and idempotency token", async () => {
        const mock = createFetchMock(() => jsonResponse({ data: { status: "sent" } }));
        const client = new GlitchClient(config, mock.fetch);
        await expect(tool.handler(client, {
            operation: "replies.send", campaign_id: campaignId, reply_id: replyId,
            client_message_id: clientMessageId, fields: { body: "Thanks for responding" },
        })).rejects.toThrow("confirm=true");
        await expect(tool.handler(client, { operation: "replies.send", confirm: true, campaign_id: campaignId }))
            .rejects.toThrow("requires campaign_id");
        expect(mock.requests).toHaveLength(0);
        const success = await tool.handler(client, {
            operation: "replies.send", confirm: true, campaign_id: campaignId, reply_id: replyId,
            client_message_id: clientMessageId, fields: { body: "Thanks for responding" },
        });
        expect(success.isError).toBeUndefined();
        expect(mock.requests).toHaveLength(1);
        expect(mock.requests[0]?.init?.method).toBe("POST");
        expect(mock.requests[0]?.body).toMatchObject({
            campaign_id: campaignId, reply_id: replyId, client_message_id: clientMessageId,
            confirm: true, fields: { body: "Thanks for responding" },
        });
    });
});
