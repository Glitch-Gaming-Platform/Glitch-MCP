---
description: Create a Glitch social media scheduler for a game and connect its accounts.
argument-hint: [scheduler name, platforms, posts per week]
---

Use Glitch MCP to set up a social media scheduler for my game.

Optional arguments I provided: $ARGUMENTS

1. If no title is selected, call `glitch_list_titles` and ask me which title to use. Call `glitch_get_social_capabilities` to see existing schedulers, supported platforms and required arguments.
2. If a scheduler already exists for this game, show it and ask whether I want another one.
3. Ask me for anything missing: the scheduler name, posts per week, and which platforms to connect.
4. Call `glitch_social_operation` with `operation=schedulers.create`, `arguments={ name, posts_per_week, ... }` and `confirm=true`.
5. For each platform I chose, call `oauth.connect.start` with the new `scheduler_id`, the platform and `confirm=true`, and give me the consent link. After I authorize, check `oauth.connect.status`.
6. Summarize the scheduler, its connected accounts and what to do next (generate content or create the first posts). Do not publish anything without my approval.
