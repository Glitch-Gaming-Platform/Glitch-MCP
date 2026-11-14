import * as z from "zod/v4";
import type { GlitchToolDefinition } from "./tools.js";
import type { GlitchClient } from "./glitchClient.js";
import { toolSuccess } from "./result.js";

const id = z.uuid();
const title_id = id.optional().describe("Game title UUID. Omit to use the MCP-selected title.");
const read = z.object({
  title_id,
  campaign_id: id.describe("Campaign UUID. Must belong to the title authorized by this MCP credential."),
  operation: z.enum(["settings", "search", "similar", "active-lookalikes", "live-streams"])
    .describe("settings: current selections, outreach flags, version; search: IGDB game name/category query; similar: related games; active-lookalikes: games verified streamed in the previous seven days; live-streams: fresh Twitch live stream sample for given IGDB IDs."),
  query: z.string().trim().min(2).max(120).optional()
    .describe("Search IGDB for a specific game or a genre/keyword, e.g. survival horror, city builder, mechs. Used for search."),
  igdb_id: z.number().int().positive().optional()
    .describe("Confirmed IGDB seed ID for similar or active-lookalikes. Defaults to campaign's game if available."),
  igdb_ids: z.array(z.number().int().positive()).min(1).max(25).optional()
    .describe("IGDB IDs to check against live Twitch streams. Used for live-streams."),
  limit: z.number().int().min(1).max(25).default(20)
    .describe("Maximum games, up to 25. The active-lookalikes backend enforces at least five."),
}).strict();

const assign = z.object({
  title_id,
  campaign_id: id,
  igdb_ids: z.array(z.number().int().positive()).min(1).max(25)
    .describe("Explicit IGDB IDs chosen from active-lookalikes research. The server verifies each game was streamed in the previous seven days and is relevant."),
  igdb_id: z.number().int().positive().optional().describe("Optional confirmed IGDB seed game ID."),
  expected_version: z.string().regex(/^[0-9a-f]{64}$/)
    .describe("Exact selection_version returned by settings or active-lookalikes; guards against stale AI assignments."),
  confirm: z.boolean().default(false)
    .describe("Must be true to save the selected lookalike IDs."),
  confirm_outreach_impact: z.boolean().default(false)
    .describe("Must be true if the campaign has automated sourcing or auto-invites. Saving IDs can queue sourcing and future invitations. It does NOT send an immediate email."),
}).strict();

export const campaignGameSourcingToolDefinitions: GlitchToolDefinition[] = [
  {
    name: "glitch_research_campaign_lookalike_games",
    title: "Research Campaign Games and Twitch Streams",
    description: "Research lookalike games for an influencer campaign without a Glitch Agent subscription or browser cookies. Requires only an authorized Glitch MCP credential with social:read. Use operation=settings to get existing IGDB IDs, auto-invite flags and selection_version; search to find games/genres in IGDB; similar to find related titles; active-lookalikes to rank relevant games with verified Twitch streams in the past seven days (NOT guaranteed live now); live-streams to sample ACTUAL Twitch live viewers and streamer profiles for explicit IGDB IDs. Results distinguish fresh live data from cached historic activity; research never saves campaigns or invites creators. Use glitch_assign_campaign_lookalike_games after review.",
    inputSchema: read.shape,
    validationSchema: read,
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    handler: async (client: GlitchClient, input) => {
      const p = read.parse(input);
      if (p.operation === "live-streams" && !p.igdb_ids?.length) {
        throw new Error("live-streams requires igdb_ids from earlier research.");
      }
      if (p.operation === "similar" && !p.igdb_id) {
        // Backend can use campaign IGDB seed, but tell AIs how to recover it.
      }
      const data = await client.influencerCampaignOperation(client.resolveTitleId(p.title_id),
        "sourcing." + p.operation, {
          campaign_id: p.campaign_id,
          ...(p.query ? { query: p.query } : {}),
          ...(p.igdb_id ? { igdb_id: p.igdb_id } : {}),
          ...(p.igdb_ids ? { igdb_ids: p.igdb_ids } : {}),
          limit: p.limit,
        });
      return toolSuccess({
        title: "Campaign game sourcing: " + p.operation,
        summary: "Read the returned structured game IDs, Twitch observation timestamps and campaign selection_version. No campaign game assignment or outreach occurred.",
        data,
      });
    },
  },
  {
    name: "glitch_assign_campaign_lookalike_games",
    title: "Assign Verified Lookalike Games to Campaign",
    description: "Save 1–25 explicitly selected IGDB lookalike game IDs for the authorized title's influencer campaign. Requires social:write, confirm=true and the exact selection_version from research/settings. Backend re-verifies that every ID is relevant and had Twitch activity in the last seven days, preserves all sourcing/auto-invite settings, and rejects stale changes. If automated sourcing or auto-invites are already enabled, confirm_outreach_impact=true is also REQUIRED: updating the mapping can queue creator discovery and subsequent automatic invitations, even though this MCP tool sends no email directly. Does not start a paid Glitch Agent or use a browser session.",
    inputSchema: assign.shape,
    validationSchema: assign,
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    handler: async (client: GlitchClient, input) => {
      const p = assign.parse(input);
      if (!p.confirm) throw new Error("Set confirm=true to approve assignment of lookalike games.");
      const data = await client.influencerCampaignOperation(client.resolveTitleId(p.title_id),
        "sourcing.assign-lookalikes", {
          campaign_id: p.campaign_id,
          igdb_ids: p.igdb_ids,
          ...(p.igdb_id ? { igdb_id: p.igdb_id } : {}),
          expected_version: p.expected_version,
          confirm: true,
          confirm_outreach_impact: p.confirm_outreach_impact,
        });
      return toolSuccess({
        title: "Campaign lookalike game assignment",
        summary: "Inspect structuredContent.data.settings to verify the saved games. The MCP tool sends no messages, but the existing campaign's automatic sourcing/invitation processes may run afterward.",
        data,
      });
    },
  },
];
