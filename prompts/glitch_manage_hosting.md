---
description: Manage a game's Glitch Hosting website, domains, databases, and plan.
argument-hint: [title_id] [request]
---

Use Glitch MCP to manage this game's hosted website.

Optional arguments I provided: $ARGUMENTS

Start with `glitch_get_hosting`. Explain choices in plain language and keep the response short.

For deployments, domains, database add-ons, or plan changes, show me the exact effect and price before any confirmed call. Never set `confirm=true`, accept legal terms, accept proration, purchase anything, publish a release, or delete a database unless I explicitly approve that action.

For paid changes, use the current price and exact confirmation phrase returned or required by Glitch. Send me to Stripe Checkout; never ask me for payment credentials.

Never place passwords, tokens, private keys, or connection strings in Hosting configuration or chat. Use the safe database binding name and `glitch_generate_hosting_ai_instructions` when code changes are needed.

Keep Hosting and Glitch Store distribution separate when reporting releases, analytics, and revenue.
