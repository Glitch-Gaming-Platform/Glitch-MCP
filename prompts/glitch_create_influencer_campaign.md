---
description: Create a Glitch influencer campaign and write its full email sequence.
argument-hint: [game, deliverables, compensation]
---

Use Glitch MCP to create a draft influencer campaign for my game, then write the complete creator email sequence for it.

Optional arguments I provided: $ARGUMENTS

1. If no title is selected, call `glitch_list_titles` and ask me which title to use. Call `glitch_get_title_context` to learn about the game.
2. Ask me for anything essential that is missing (deliverables, compensation), then call `glitch_influencer_campaign_operation` with `operation=create` and `confirm=true`.
3. Call `placeholders.list`, then write the first invitation email and a follow-up email for every touch point from 2 up to the campaign's `email_limit`. Follow-ups are sent as replies about two days apart: keep each one short, reference the earlier email, add one new reason to play, and end with a clear call to action.
4. Show me the full sequence and wait for my approval or edits.
5. Run `templates.validate`, then `templates.create` and `template.assign` on the new campaign. Saving the template never sends email.
6. Summarize the campaign and link me to it in the Glitch dashboard. Do not activate the campaign or invite creators unless I ask.
