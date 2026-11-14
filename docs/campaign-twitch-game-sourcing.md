# Influencer campaign: research Twitch-streamed lookalike games with Glitch MCP

An authorized AI can research relevant IGDB games, check historic and genuinely live Twitch stream activity, and assign verified IGDB game IDs to an influencer campaign. This works with a **title-scoped Glitch MCP token**. It does **not** require a logged-in browser session, the Glitch Agent subscription, or a separate Twitch OAuth login for the AI. The backend manages its own IGDB/Twitch provider credentials.

## Available MCP tools

- `glitch_research_campaign_lookalike_games` (requires `social:read`). Set `campaign_id` and one of:
  - `operation: "settings"`: current campaign game IDs, IGDB seed, automation and invite flags, verification timestamp, and `selection_version`. **Do this first**.
  - `operation: "search"`, `query: "survival horror"` or `"mech combat"`: game candidates from IGDB with named, timestamped locally observed Twitch activity and Steam player data when available. Search specific games and descriptive keywords separately; IGDB search is primarily title/keyword based, not a complete genre catalog. Search results are **not** automatically qualified lookalikes.
  - `operation: "similar"`, `igdb_id`: IGDB similar games to a confirmed title.
  - `operation: "active-lookalikes"`, optional `igdb_id`, `limit: 25`: strict recommendation set of relevant game IDs with at least one stream observation in the previous seven days; **no campaign mutation**. Returns `ready`, `qualified_count`, `minimum`, `activity_window_days`, `games`, and `selection_version`.
  - `operation: "live-streams"`, `igdb_ids: [123,456]`: uncached Twitch Helix request for the current **top 100 live streams sampled across those categories**, with public streamer names/URLs, viewer counts, and `sampled_at`. `sampled_stream_count` and `sampled_viewers` are lower bounds when Twitch reports more pages, not complete channel totals. The 24-hour Twitch category-ID cache does **not** cache the live stream query.
  - `operation: "verify-games"`, `igdb_ids: [123,456]`: verify a curated selection against real IGDB games and recent or current Twitch activity. This does not restrict IDs to automatic similarities.
- `glitch_assign_campaign_lookalike_games` (requires `social:write`). After reviewing the candidates, pass `campaign_id`, your selected `igdb_ids` (1–25), `expected_version` from the latest research/settings, `confirm: true`, and `confirm_curated_relevance: true`. The backend validates each IGDB game and stream evidence independently, **without requiring it in the generated list**. Games without stream evidence are marked as such; campaigns requiring active-stream lookalikes still need at least five verified. The original game cannot be its own lookalike. A changed campaign selection/outreach configuration returns HTTP 409; refresh settings and retry.

**IMPORTANT: Outreach impact.** Updating `similar_game_igdb_ids` triggers the existing CampaignObserver, which can queue creator sourcing or seed creator pools. An active campaign with `is_sourcing_automated` or `auto_invite_sourced_creators` can subsequently invite those creators. The assignment call requires **`confirm_outreach_impact: true`** when either setting is enabled. It never sends a direct email or invitation itself, and it never flips `auto_invite_sourced_creators`, `send_daily_emails`, `is_sourcing_automated`, or `activate_sourcing`. Do **not** assume that saving games has no indirect side effects.

## Recommended AI sequence

1. Call `settings` and inspect all automation, auto-invite, campaign dates, and current selected IDs.
2. Search genres and seed-game titles such as RPGs, survival, city builders, mechs, and alien invasions. Check `similar` for a specific verified IGDB seed.
3. Call `active-lookalikes` at a limit up to 25. These results have **recent streamed evidence, not necessarily currently-live viewers**. Exclude irrelevant broad games even if popular.
4. Call `verify-games` using the exact IGDB IDs of your **hand-picked** candidates; they need not appear in `active-lookalikes`. Optionally call `live-streams` to inspect individual public streamers and their current viewer samples. These are bounded snapshots, not complete live totals or trends.
5. Present the intended final IGDB IDs, note any unverified games and whether assignment can trigger creator invitations. After explicit approval, call `glitch_assign_campaign_lookalike_games` with the fresh `selection_version`, `confirm_curated_relevance`, and required outreach confirmation.
6. Call `settings` again and verify persisted IDs. For subsequent creator sourcing and invitation status, use `glitch_influencer_campaign_operation` with `invitations.list` and the campaign UI. Assigning games is not proof any creator has been contacted.

## Permissions and boundaries

The Glitch backend enforces the existing title-scoped MCP principal and `social:read` / `social:write` abilities. Campaigns on another title return 404. A Glitch Agent billing failure has **no effect** on this direct, authorized MCP research route. Missing backend Twitch/IGDB credentials or provider failures return an explicit error, **not** fabricated stream results. A browser login or copying browser session tokens is never needed.

Read-only research operations use authenticated JSON POST requests for arrays of IGDB IDs (rather than ambiguous query-string arrays); their backend permission remains `social:read`. Assignment requires `social:write` and explicit confirmation. All information is public game/stream data; no private stream or creator account tokens are returned.

## Curated games outside the automatic similarity list (MCP 0.5.8)

The main game's IGDB similarity list is a recommendation, **not an allowlist**. An AI may select 1–25 valid IGDB game IDs researched independently, including survival, city-building, alien-invasion, mech, and RPG titles not suggested by the campaign generator.

Call `glitch_research_campaign_lookalike_games` with `operation: "verify-games"`, the campaign ID and exact `igdb_ids`. This read-only operation verifies that every IGDB game exists, checks current Twitch activity and Glitch's recorded previous-seven-day observations, and returns per-game evidence, stream timestamps, and whether the campaign's five-game activity minimum is met. A real game without stream evidence can remain a curated selection, but is marked unverified. Where the campaign requires active-stream lookalikes, at least five games must have independent Twitch evidence. The source title itself cannot be a lookalike.

Then call `glitch_assign_campaign_lookalike_games` with the exact IDs, the recent `selection_version`, `confirm: true`, and `confirm_curated_relevance: true` to acknowledge editorial relevance. When auto-sourcing or auto-invites are already enabled, also set `confirm_outreach_impact: true` after considering that saving games can queue creator research and later send invitations. The MCP never sends email directly in this step, but the existing campaign automation can send emails subsequently.

## Read and update campaign budget caps

Call `glitch_get_campaign_budget_caps` with `campaign_id` to view the two real USD caps, usage/remaining budget during the billing period, and `budget_version`. The independent cap fields are `enrichment_spend_cap_usd` and `email_send_spend_cap_usd`; the inherited default is $300 for each metric when unset. Both are per-campaign billing-period spending guards, not prepaid balances.

Call `glitch_update_campaign_budget_caps` with `campaign_id`, `budget_caps` containing one or both amounts in USD between $0 and $1,000,000 (at most 2 decimals), `expected_version` copied from `budget_version`, and `confirm: true`. This operation preserves all campaign outreach flags, resets the corresponding cap-exceeded notification when changed, and rejects stale concurrent edits with HTTP 409. **Increasing a cap allows more billable work to proceed**, so AIs should explain financial consequences before seeking confirmation. It does not alter subscription pricing or send invitations on its own.
