import * as z from "zod/v4";
import type { GlitchToolDefinition } from "./tools.js";
import type { GlitchClient, JsonObject } from "./glitchClient.js";
import { toolSuccess } from "./result.js";
import { campaignEditorPlaceholders, campaignAdditionalPlaceholders, campaignPlaceholderGuidance, analyzeCampaignTemplateFields } from "./influencerCampaignPlaceholders.js";

const uuid = z.uuid();
const title_id = uuid.optional().describe("Title UUID; otherwise the selected title.");
const op = z.enum([
  "placeholders.list", "templates.validate", "list", "get", "create", "update", "pause", "resume",
  "templates.list", "templates.get", "templates.create", "templates.update",
  "templates.delete", "template.assign", "invitations.list"
]);
const request = z.object({
  title_id,
  operation: op,
  campaign_id: uuid.optional(),
  template_id: uuid.optional(),
  fields: z.record(z.string(), z.unknown()).optional(),
  confirm: z.boolean().default(false)
}).strict();

const catalogMarkdown = (["influencer", "campaign", "game", "keys"] as const)
  .map((group) => {
    const lines = campaignEditorPlaceholders.filter((item) => item.group === group)
      .map((item) => `- \`${item.token}\` — ${item.resolvesFrom}. ${item.usage}`);
    return `### ${group}
${lines.join("\n")}`;
  }).join("\n\n")
  + "\n\n### Other renderer-supported tokens (not in editor palette)\n"
  + campaignAdditionalPlaceholders.map((item) => `- \`${item.token}\` — ${item.usage}`).join("\n")
  + "\n\n### Correct use\n" + campaignPlaceholderGuidance.map((item) => `- ${item}`).join("\n");

const readonly = new Set(["placeholders.list", "templates.validate", "list", "get", "templates.list", "templates.get", "invitations.list"]);

export const influencerCampaignToolDefinitions: GlitchToolDefinition[] = [
  {
    name: "glitch_influencer_campaign_operation",
    title: "Manage Influencer Campaign",
    description: "Manage title-scoped influencer campaigns. Before drafting email or DM outreach, call operation=placeholders.list to obtain ALL exact Glitch campaign/influencer/game/access-key placeholders with their real sources, fallback rules and examples. Call templates.validate with fields for a dry-run token check; unknown/malformed placeholders are reported. Then use templates.create/update/assign to save, preserving literal {{tokens}} for recipient-specific substitution. Supports draft create with game title context, deliverables and optional compensation, plus list/get/update/pause/resume and invitations.list. Existing social:read/social:write permissions, no added scopes or MCP-only auto-invite restrictions.",
    inputSchema: request.shape,
    validationSchema: request,
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    handler: async (client: GlitchClient, input) => {
      const parsed = request.parse(input);
      if (!readonly.has(parsed.operation) && !parsed.confirm) {
        throw new Error("Set confirm=true to approve this campaign mutation.");
      }
      if (parsed.operation === "placeholders.list") {
        return toolSuccess({
          title: "Campaign outreach placeholders",
          summary: "Exact tokens from the Glitch outreach editor and email renderer; leave tokens intact in stored templates.",
          bodyMarkdown: catalogMarkdown,
          data: { editor: campaignEditorPlaceholders, additionalRendererTokens: campaignAdditionalPlaceholders, guidance: campaignPlaceholderGuidance }
        });
      }
      if (parsed.operation === "templates.validate") {
        if (!parsed.fields) throw new Error("Provide fields containing draft email or social touchpoint content.");
        return toolSuccess({
          title: "Campaign template placeholder preflight",
          summary: "Read warnings before saving; this does not preview actual personalized content or contact any recipients.",
          bodyMarkdown: (() => {
            const analysis = analyzeCampaignTemplateFields(parsed.fields!);
            return analysis.warnings.length ? analysis.warnings.map((warning) =>
              `- **${warning.field}**: \`${warning.token}\` — ${warning.message}`).join("\n")
              : "All detected placeholders are recognized. Actual values are filled only at send time.";
          })(),
          data: { ...analyzeCampaignTemplateFields(parsed.fields), guidance: campaignPlaceholderGuidance }
        });
      }
      const inspection = parsed.fields ? analyzeCampaignTemplateFields(parsed.fields) : null;
      const titleId = client.resolveTitleId(parsed.title_id);
      const data = await client.influencerCampaignOperation(titleId, parsed.operation, {
        ...(parsed.campaign_id ? { campaign_id: parsed.campaign_id } : {}),
        ...(parsed.template_id ? { template_id: parsed.template_id } : {}),
        ...(parsed.fields ? { fields: parsed.fields } : {})
      } as JsonObject);
      return toolSuccess({
        title: "Influencer campaign: " + parsed.operation,
        summary: "Glitch returned the authoritative campaign state. Read structuredContent.data before claiming a change succeeded; this tool does not send invitations.",
        ...(inspection?.warnings.length ? { bodyMarkdown: inspection.warnings.map((warning) =>
          `- **${warning.field}**: \`${warning.token}\` — ${warning.message}`).join("\n") } : {}),
        data: { ...data, ...(inspection ? { placeholderAnalysis: inspection } : {}) }
      });
    }
  }
];
