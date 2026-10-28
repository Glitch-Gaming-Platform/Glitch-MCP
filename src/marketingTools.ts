import * as z from "zod/v4";
import type { GlitchToolDefinition } from "./tools.js";
import { toolSuccess } from "./result.js";

const capabilities = z.object({ title_id: z.uuid().optional() }).strict();
const request = z.object({
  title_id: z.uuid().optional(),
  operation: z.string().regex(/^[a-z][a-z0-9._-]{2,90}$/),
  arguments: z.record(z.string(), z.unknown()).default({}),
  confirm: z.boolean().default(false)
}).strict();

const readOnly = new Set([
  "campaigns.list", "campaigns.get", "groups.list", "groups.get",
  "creatives.list", "creatives.get", "conversions.status", "conversions.actions", "conversions.sources",
  "conversions.events", "conversions.report",
  "reports.summary", "reports.spend_delivery", "reports.platform_comparison",
  "reports.creative_performance", "reports.time_performance", "reports.detailed_breakdown"
]);

export const marketingToolDefinitions: GlitchToolDefinition[] = [
  {
    name: "glitch_get_marketing_capabilities",
    title: "Get Advertising and Conversion Capabilities",
    description: "Discover supported ad campaign, group, creative, reporting, and conversion setup operations. Uses existing social read access, including eligible ordinary marketing subscriptions.",
    inputSchema: capabilities.shape,
    validationSchema: capabilities,
    readOnlyHint: true,
    handler: async (client, input) => {
      const parsed = capabilities.parse(input);
      const titleId = client.resolveTitleId(parsed.title_id);
      const data = await client.marketingCapabilities(titleId);
      return toolSuccess({ title: "Advertising and conversion operations", data });
    }
  },
  {
    name: "glitch_marketing_operation",
    title: "Manage Advertising and Conversion Tracking",
    description: "Use operations discovered by glitch_get_marketing_capabilities. Manage title-owned ad campaigns, groups, creatives and 90-day reports; configure non-secret pixel IDs/event mappings, inspect conversion health and delivery, and use conversions.sources (or conversions.actions) to discover Google conversion actions, Meta/TikTok/Reddit pixels, or X web-event tags from a connected Ads account (never proof of delivery). Set platform to google, meta, tiktok, reddit, or twitter and supply account_id where required. All mutations need confirm=true. Does not accept provider credentials: complete OAuth using Glitch. Always inspect remote sync status before claiming a campaign is live.",
    inputSchema: request.shape,
    validationSchema: request,
    destructiveHint: true,
    handler: async (client, input) => {
      const parsed = request.parse(input);
      if (!readOnly.has(parsed.operation) && !parsed.confirm) {
        throw new Error("Set confirm=true for this marketing mutation.");
      }
      const titleId = client.resolveTitleId(parsed.title_id);
      const data = await client.marketingOperation(titleId, parsed.operation, parsed.arguments, parsed.confirm);
      return toolSuccess({
        title: "Marketing operation: " + parsed.operation,
        summary: "Glitch returned the backend operation result. Local drafts and remotely published ads are distinct states.",
        data
      });
    }
  }
];
