---
description: Check the Glitch MCP plan ($10/month per game) and agent runs left.
argument-hint: [title_id]
---

Use Glitch MCP tool `glitch_get_billing_status` to check whether this game has Glitch MCP access. Glitch MCP is $10/month per game, and every paid Glitch plan includes it.

Arguments I provided: $ARGUMENTS

If I provided a title id, pass it as `title_id`. Otherwise use the selected title, or call `glitch_list_titles` and ask me which title to use.
Tell me whether Glitch MCP is active, which plan covers it, and how many Glitch Agent runs are left this month. If it is not active, give me the $10/month price and the subscribe link Glitch returned.
