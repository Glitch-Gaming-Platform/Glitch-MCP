/**
 * Campaign outreach placeholders displayed in CampaignOutreachPage and
 * substituted by EmailTemplateRenderer. Keep this catalog in sync with both.
 *
 * These are literal runtime tokens, not JavaScript interpolation or Mustache
 * expressions. Do not replace recipient-specific tokens before saving.
 */
export type CampaignPlaceholderGroup = "influencer" | "campaign" | "game" | "keys";
export type CampaignPlaceholderDefinition = {
  token: string;
  group: CampaignPlaceholderGroup;
  resolvesFrom: string;
  usage: string;
};

const definitions: CampaignPlaceholderDefinition[] = [
  { token: "{{first_name}}", group: "influencer", resolvesFrom: "Influencer.first_name; falls back to dynamic_name", usage: "First name when available. Prefer dynamic_name for a personalized greeting with a broader fallback." },
  { token: "{{dynamic_name}}", group: "influencer", resolvesFrom: "First name, then available channel identity, otherwise 'there'", usage: "Recommended salutation. Resolved separately for each influencer at send time." },
  { token: "{{instagram_username}}", group: "influencer", resolvesFrom: "Influencer.instagram_username", usage: "Instagram handle. Blank if absent." },
  { token: "{{tiktok_username}}", group: "influencer", resolvesFrom: "Influencer.tiktok_username", usage: "TikTok handle. Blank if absent." },
  { token: "{{youtube_channel}}", group: "influencer", resolvesFrom: "Influencer.youtube_title", usage: "YouTube channel title. Blank if absent." },
  { token: "{{twitch_username}}", group: "influencer", resolvesFrom: "Influencer.twitch_username", usage: "Twitch handle. Blank if absent." },
  { token: "{{twitter_username}}", group: "influencer", resolvesFrom: "Influencer.twitter_username", usage: "Twitter/X handle. Blank if absent." },
  { token: "{{bluesky_username}}", group: "influencer", resolvesFrom: "Influencer.bluesky_username", usage: "Bluesky handle. Blank if absent." },
  { token: "{{facebook_username}}", group: "influencer", resolvesFrom: "Influencer.facebook_username", usage: "Facebook handle. Blank if absent." },
  { token: "{{reddit_username}}", group: "influencer", resolvesFrom: "Influencer.reddit_username", usage: "Reddit handle. Blank if absent." },

  { token: "{{campaign_name}}", group: "campaign", resolvesFrom: "Campaign.name", usage: "Human-readable influencer campaign name, not a campaign UUID or game title." },
  { token: "{{campaign_description}}", group: "campaign", resolvesFrom: "Campaign.description", usage: "Campaign description. May be empty." },
  { token: "{{campaign_objective}}", group: "campaign", resolvesFrom: "Campaign.objective", usage: "Campaign objective. May be empty." },
  { token: "{{campaign_deliverables}}", group: "campaign", resolvesFrom: "Campaign.deliverables", usage: "Expected creator deliverables. May be empty." },
  { token: "{{campaign_days_to_complete}}", group: "campaign", resolvesFrom: "Campaign.days_to_complete", usage: "Campaign completion duration, not the creator-access window." },
  { token: "{{campaign_late_penalty_percentage}}", group: "campaign", resolvesFrom: "Campaign.late_penalty_percentage", usage: "Late penalty number, not formatted with a percent sign by the renderer." },
  { token: "{{campaign_spend_limit_per_influencer}}", group: "campaign", resolvesFrom: "Campaign.spend_limit_per_influencer", usage: "Spend limit number; currency formatting is not added automatically." },
  { token: "{{campaign_start_date}}", group: "campaign", resolvesFrom: "Campaign.start_date", usage: "Y-m-d format only if campaign start date is configured. This is not necessarily an access start date." },
  { token: "{{campaign_end_date}}", group: "campaign", resolvesFrom: "Campaign.end_date", usage: "Y-m-d format only if campaign end date is configured. This is not necessarily an access end date." },
  { token: "{{campaign_link}}", group: "campaign", resolvesFrom: "Influencer invitation path when a recipient is supplied; adds the invite token when available, campaign page without recipient", usage: "Use in invitations to direct creators to the campaign. A recipient path is only fully tokenized when an invitation token exists; do not hardcode the link." },

  { token: "{{game_title}}", group: "game", resolvesFrom: "Title.name", usage: "Game title (e.g., War of the Worlds Trilogy); use instead of campaign_name for the game name." },
  { token: "{{game_short_description}}", group: "game", resolvesFrom: "Title.short_description", usage: "Game short description. May be empty." },
  { token: "{{game_long_description}}", group: "game", resolvesFrom: "Title.long_description", usage: "Game long description. May be empty." },
  { token: "{{game_pricing}}", group: "game", resolvesFrom: "Title.pricing", usage: "Game pricing field, not a guaranteed currency-formatted retail price." },
  { token: "{{game_publisher}}", group: "game", resolvesFrom: "Title.publisher", usage: "Publisher, if configured." },
  { token: "{{game_developer}}", group: "game", resolvesFrom: "Title.developer", usage: "Developer, if configured." },
  { token: "{{game_steam_url}}", group: "game", resolvesFrom: "Title.steam_url", usage: "Steam store page, if configured." },
  { token: "{{game_itch_url}}", group: "game", resolvesFrom: "Title.itch_url", usage: "itch.io page, if configured." },
  { token: "{{game_iphone_url}}", group: "game", resolvesFrom: "Title.apple_url", usage: "iOS/iPhone page, if configured." },
  { token: "{{game_android_url}}", group: "game", resolvesFrom: "Title.android_url", usage: "Android page, if configured." },
  { token: "{{game_website_url}}", group: "game", resolvesFrom: "Title.website_url", usage: "Game website, if configured." },

  { token: "{{access_key}}", group: "keys", resolvesFrom: "The particular invitation's assigned access key", usage: "Only use when appropriate for keyed access. The renderer substitutes 'Key provided upon acceptance' when a recipient exists but no key code is supplied; this token does not grant full-game access by itself." }
];

// Renderer-supported compatibility placeholders, not in the outreach editor's palette.
const extra: CampaignPlaceholderDefinition[] = [
  { token: "{{campaign_url}}", group: "campaign", resolvesFrom: "Same as campaign_link", usage: "Alias supported by EmailTemplateRenderer; campaign_link matches the UI." },
  { token: "{{game_glitch_url}}", group: "game", resolvesFrom: "Glitch game landing URL when Title.is_live", usage: "Only resolves to a URL for live games; can be blank." },
  { token: "{{game_glitch_play_url}}", group: "game", resolvesFrom: "Glitch play URL when Title.is_live", usage: "Only resolves to a URL for live games; can be blank." }
];

export const campaignEditorPlaceholders = definitions;
export const campaignAdditionalPlaceholders = extra;

const supportedTokens = new Set([...definitions, ...extra].map((entry) => entry.token));

export function analyzeCampaignTemplateFields(fields: Record<string, unknown>): {
  known: string[];
  warnings: { field: string; token: string; message: string }[];
} {
  const known = new Set<string>();
  const warnings: { field: string; token: string; message: string }[] = [];
  const contentField = /^(subject|text_version|html_version|email_touch_point_[2-5]_(subject|text|html)|(?:twitter_dm|tiktok_dm|linkedin|instagram_dm|bluesky_dm)_touch_point_[1-5]_content)$/;
  for (const [field, value] of Object.entries(fields)) {
    if (!contentField.test(field) || typeof value !== "string") continue;
    for (const match of value.matchAll(/\{\{[^{}]*\}\}/g)) {
      const token = match[0];
      if (supportedTokens.has(token)) known.add(token);
      else warnings.push({
        field,
        token,
        message: "This exact placeholder is not supported. Check spelling and use an exact token from the placeholder catalog; unrecognized tokens will remain in the outgoing content."
      });
    }
  }
  return { known: [...known], warnings };
}

export const campaignPlaceholderGuidance = [
  "Keep {{tokens}} literally in stored template text; Glitch replaces them per recipient at delivery/preview time. Never pre-fill private creator names, keys or personalized invite links in a shared template.",
  "Use {{dynamic_name}} in greetings; {{first_name}} also falls back to dynamic_name in the normal email renderer.",
  "Use {{game_title}} for the game's name and {{campaign_name}} for the campaign's own name. Never put UUIDs in greeting or subject copy.",
  "Use {{campaign_link}} for recipient invitation links. With a recipient but no saved invitation token, preview can show an invitation path without the token; without a recipient it shows the general campaign page.",
  "Only use {{access_key}} if access keys are truly assigned. The fallback phrase does not guarantee a key exists.",
  "Fields for email #1: subject, text_version, html_version. Follow-up #1 uses email_touch_point_2_*, follow-up #2 uses email_touch_point_3_*, and so on up to touch point 5.",
  "Dates {{campaign_start_date}}/{{campaign_end_date}} are campaign dates, not automatically the full-game early-access period. Use literal access dates when distinct.",
  "Some channel, game and campaign values may be blank. Avoid relying on optional tokens without reviewing populated content. Unknown tokens are reported as warnings; the tool does not silently rewrite your message.",
  "The MCP provides a catalog and preflight inspection, not an independently rendered sample. Final substitution is performed by the Glitch backend."
];
