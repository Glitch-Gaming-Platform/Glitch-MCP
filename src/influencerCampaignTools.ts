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
  "templates.delete", "template.assign", "invitations.list", "replies.list", "replies.get", "replies.send"
]);
const request = z.object({
  title_id,
  operation: op,
  campaign_id: uuid.optional(),
  template_id: uuid.optional(),
  reply_id: uuid.optional().describe("Inbound reply UUID obtained from replies.list."),
  client_message_id: uuid.optional().describe("New UUID for idempotent email send; reuse on retry."),
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

/** Shown after a campaign draft is created so the client AI writes the whole email sequence up front. */
export const campaignFollowUpNextSteps = [
  "### Next: write the outreach and follow-up emails",
  "1. Call `placeholders.list` and use the exact `{{tokens}}` it returns for personalization.",
  "2. Write the first invitation (`subject`, `text_version`, `html_version`) and a follow-up for each touch point from 2 up to the campaign `email_limit` (`email_touch_point_N_subject`, `email_touch_point_N_text`, `email_touch_point_N_html`).",
  "3. Follow-ups go out as replies about two days apart: keep them short, reference the previous email, add one new reason to play, and end with a clear call to action.",
  "4. Show the sequence to the developer, run `templates.validate`, then `templates.create` with `campaign_id` and `confirm=true`.",
  "5. Attach it with `template.assign` using the returned template id. Saving or assigning a template never sends email."
];

const readonly = new Set(["placeholders.list", "templates.validate", "list", "get", "templates.list", "templates.get", "invitations.list", "replies.list", "replies.get"]);

export const influencerCampaignToolDefinitions: GlitchToolDefinition[] = [
  {
    name: "glitch_influencer_campaign_operation",
    title: "Manage Influencer Campaign",
    description: "Manage title-scoped influencer campaigns. Before drafting email or DM outreach, call operation=placeholders.list to obtain ALL exact Glitch campaign/influencer/game/access-key placeholders with their real sources, fallback rules and examples. Call templates.validate with fields for a dry-run token check; unknown/malformed placeholders are reported. Then use templates.create/update/assign to save, preserving literal {{tokens}} for recipient-specific substitution. Supports draft create with game title context, deliverables and optional compensation. AFTER operation=create you MUST write the creator outreach sequence for the developer: the first invitation email plus a follow-up email for every touch point from 2 up to the campaign email_limit (default 5). Follow-ups are sent as replies about two days apart, so keep each short, reference the earlier email and add one new reason to play. Show the draft to the developer, run templates.validate, then templates.create and template.assign on the new campaign; saving never sends email. Also supports plus list/get/update/pause/resume, invitations.list, and replies.list/get/send. Email replies are tracked and returned only for the selected campaign. replies.send sends a REAL email via Glitch's configured mail transport, requires confirm=true, a reply_id and an idempotent client_message_id UUID. It does not claim final delivery. Use glitch_research_campaign_lookalike_games and glitch_assign_campaign_lookalike_games for IGDB and Twitch research/assignment. Existing social:read/social:write permissions, no new scopes.",
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
      if (parsed.operation === "replies.send" && (!parsed.campaign_id || !parsed.reply_id ||
          !parsed.client_message_id || !parsed.fields || typeof parsed.fields.body !== "string" ||
          !parsed.fields.body.trim())) {
        throw new Error("replies.send requires campaign_id, reply_id, client_message_id UUID and non-empty fields.body.");
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
        ...(parsed.reply_id ? { reply_id: parsed.reply_id } : {}),
        ...(parsed.client_message_id ? { client_message_id: parsed.client_message_id } : {}),
        ...(parsed.confirm ? { confirm: true } : {}),
        ...(parsed.fields ? { fields: parsed.fields } : {})
      } as JsonObject);
      if (parsed.operation === "create") {
        return toolSuccess({
          title: "Influencer campaign draft created",
          summary: "Draft saved; nothing was sent. Next, write the invitation and every follow-up email for this campaign before activating it.",
          bodyMarkdown: [
            ...(inspection?.warnings.length ? inspection.warnings.map((warning) =>
              `- **${warning.field}**: \`${warning.token}\` — ${warning.message}`) : []),
            ...campaignFollowUpNextSteps
          ].join("\n"),
          data: { ...data, ...(inspection ? { placeholderAnalysis: inspection } : {}) }
        });
      }
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
