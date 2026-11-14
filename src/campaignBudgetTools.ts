import * as z from "zod/v4";
import type { GlitchToolDefinition } from "./tools.js";
import type { GlitchClient } from "./glitchClient.js";
import { toolSuccess } from "./result.js";

const uuid = z.uuid();
const title_id = uuid.optional().describe("Optional title UUID; defaults to the selected game title.");
const amount = z.number().finite().min(0).max(1000000).refine(
  v => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6,
  "Specify a USD amount with at most two decimal places."
);
const budgetCaps = z.object({
  enrichment_spend_cap_usd: amount.optional().describe("Maximum charged enrichment spend in USD for this campaign and billing period."),
  email_send_spend_cap_usd: amount.optional().describe("Maximum charged creator-email send spend in USD for this campaign and billing period."),
}).strict().refine(v => v.enrichment_spend_cap_usd !== undefined || v.email_send_spend_cap_usd !== undefined,
  "Provide at least one cap.");

const getInput = z.object({ title_id, campaign_id: uuid }).strict();
const updateInput = z.object({
  title_id,
  campaign_id: uuid,
  budget_caps: budgetCaps,
  expected_version: z.string().regex(/^[0-9a-f]{64}$/)
    .describe("budget_version from glitch_get_campaign_budget_caps; rejects conflicting edits."),
  confirm: z.boolean().default(false).describe("Must be true to change real campaign budget caps."),
}).strict();

export const campaignBudgetToolDefinitions: GlitchToolDefinition[] = [
  {
    name: "glitch_get_campaign_budget_caps",
    title: "Read Campaign Budget Caps and Usage",
    description: "Read the two real campaign-level USD spend caps: profile enrichment and creator email sending, plus current billing-period spend, remaining budgets, limits, status and budget_version. Uses title-scoped social:read. Does not require a Glitch Agent subscription, does not change caps, and does not contact creators. Read before editing.",
    inputSchema: getInput.shape,
    validationSchema: getInput,
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    handler: async (client: GlitchClient, input) => {
      const p = getInput.parse(input);
      const data = await client.influencerCampaignOperation(client.resolveTitleId(p.title_id),
        "sourcing.budget.get", { campaign_id: p.campaign_id });
      return toolSuccess({
        title: "Campaign enrichment and email budget caps",
        summary: "Inspect current spend and the exact budget_version before requesting any cap changes. No settings were modified.",
        data,
      });
    },
  },
  {
    name: "glitch_update_campaign_budget_caps",
    title: "Change Campaign Budget Caps",
    description: "Change one or both campaign sourcing/enrichment and creator-email spend caps in USD (0–1,000,000, up to two decimal places). Requires social:write, confirm=true, and the exact budget_version from the read tool; concurrent edits return HTTP 409. Updates only requested caps, preserves auto-invite and outreach flags, and uses the existing cap-notification reset behavior. Increasing a cap permits additional billable campaign activity to accrue, but this tool does not itself charge, contact creators, or add prepaid funds.",
    inputSchema: updateInput.shape,
    validationSchema: updateInput,
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    handler: async (client: GlitchClient, input) => {
      const p = updateInput.parse(input);
      if (!p.confirm) throw new Error("Set confirm=true to approve changes to campaign spending caps.");
      const data = await client.influencerCampaignOperation(client.resolveTitleId(p.title_id),
        "sourcing.budget.update", {
          campaign_id: p.campaign_id,
          budget_version: p.expected_version,
          budget_caps: p.budget_caps,
          confirm: true,
        });
      return toolSuccess({
        title: "Campaign budget caps updated",
        summary: "Check structuredContent.data.budget to verify the authoritative saved caps and usage. No campaign emails or invitations were sent directly by this tool.",
        data,
      });
    },
  },
];
