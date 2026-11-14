# Influencer campaign: research Twitch-streamed lookalike games with Glitch MCP

An authorized AI can research relevant IGDB games, check historic and genuinely live Twitch stream activity, and assign verified IGDB game IDs to an influencer campaign. This works with a **title-scoped Glitch MCP token**. It does **not** require a logged-in browser session, the Glitch Agent subscription, or a separate Twitch OAuth login for the AI. The backend manages its own IGDB/Twitch provider credentials.

## Available MCP tools

- `glitch_research_campaign_lookalike_games` (requires `social:read`). Set `campaign_id` and one of:
  - `operation: "settings"`: current campaign game IDs, IGDB seed, automation and invite flags, verification timestamp, and `selection_version`. **Do this first**.
  - `operation: "search"`, `query: "survival horror"` or `"mech combat"`: game candidates from IGDB with named, timestamped locally observed Twitch activity and Steam player data when available. Search specific games and descriptive keywords separately; IGDB search is primarily title/keyword based, not a complete genre catalog. Search results are **not** automatically qualified lookalikes.
  - `operation: "similar"`, `igdb_id`: IGDB similar games to a confirmed title.
  - `operation: "active-lookalikes"`, optional `igdb_id`, `limit: 25`: strict recommendation set of relevant game IDs with at least one stream observation in the previous seven days; **no campaign mutation**. Returns `ready`, `qualified_count`, `minimum`, `activity_window_days`, `games`, and `selection_version`.
  - `operation: "live-streams"`, `igdb_ids: [123,456]`: uncached Twitch Helix request for the current **top 100 live streams sampled across those categories**, with public streamer names/URLs, viewer counts, and `sampled_at`. `sampled_stream_count` and `sampled_viewers` are lower bounds when Twitch reports more pages, not complete channel totals. The 24-hour Twitch category-ID cache does **not** cache the live stream query.
- `glitch_assign_campaign_lookalike_games` (requires `social:write`). After reviewing the candidates, pass `campaign_id`, explicitly selected `igdb_ids` (1–25), `expected_version` from the latest research/settings, and `confirm: true`. The backend independently repeats verification of relevance and activity in the previous seven days. The original game cannot be its own lookalike. For campaigns requiring active-stream lookalikes, at least five must qualify. A changed campaign selection/outreach configuration returns HTTP 409; refresh settings and retry.

**IMPORTANT: Outreach impact.** Updating `similar_game_igdb_ids` triggers the existing CampaignObserver, which can queue creator sourcing or seed creator pools. An active campaign with `is_sourcing_automated` or `auto_invite_sourced_creators` can subsequently invite those creators. The assignment call requires **`confirm_outreach_impact: true`** when either setting is enabled. It never sends a direct email or invitation itself, and it never flips `auto_invite_sourced_creators`, `send_daily_emails`, `is_sourcing_automated`, or `activate_sourcing`. Do **not** assume that saving games has no indirect side effects.

## Recommended AI sequence

1. Call `settings` and inspect all automation, auto-invite, campaign dates, and current selected IDs.
2. Search genres and seed-game titles such as RPGs, survival, city builders, mechs, and alien invasions. Check `similar` for a specific verified IGDB seed.
3. Call `active-lookalikes` at a limit up to 25. These results have **recent streamed evidence, not necessarily currently-live viewers**. Exclude irrelevant broad games even if popular.
4. Call `live-streams` on the shortlisted IGDB IDs. It produces a live snapshot with Twitch public profiles and approximate audience evidence. Do not invent counts for categories Twitch did not match; this is a bounded snapshot, not a seven-day trend.
5. Present the intended final IGDB IDs and whether assignment can trigger creator invitations. After explicit approval, call `glitch_assign_campaign_lookalike_games` with the fresh `selection_version` and required confirmations.
6. Call `settings` again and verify persisted IDs. For subsequent creator sourcing and invitation status, use `glitch_influencer_campaign_operation` with `invitations.list` and the campaign UI. Assigning games is not proof any creator has been contacted.

## Permissions and boundaries

The Glitch backend enforces the existing title-scoped MCP principal and `social:read` / `social:write` abilities. Campaigns on another title return 404. A Glitch Agent billing failure has **no effect** on this direct, authorized MCP research route. Missing backend Twitch/IGDB credentials or provider failures return an explicit error, **not** fabricated stream results. A browser login or copying browser session tokens is never needed.

Read-only research operations use authenticated JSON POST requests for arrays of IGDB IDs (rather than ambiguous query-string arrays); their backend permission remains `social:read`. Assignment requires `social:write` and explicit confirmation. All information is public game/stream data; no private stream or creator account tokens are returned.
