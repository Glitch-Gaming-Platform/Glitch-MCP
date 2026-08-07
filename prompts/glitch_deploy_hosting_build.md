---
description: Deploy a game build to Glitch Hosting.
---

Use Glitch MCP tool `glitch_deploy_hosting_build` to deploy this game as an independent hosted website.

If the build is only available locally, call `glitch_deploy_game_build` first and use the returned build id.

Use an existing hosting site when I identify one. If no site exists, ask me for a short website name and address slug. Never guess when multiple sites exist.

Set `confirm=true` only after I explicitly approve creating the release. Publish only when I ask to go live; otherwise set `publish=false`.

After deployment, report the public URL, build id, hosting release id, and whether it is live. Make clear that Hosting and Glitch Store distribution remain separate.
