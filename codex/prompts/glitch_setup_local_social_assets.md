---
description: Create local capture folders and scan for social assets.
argument-hint: [title_id] [project_root]
---

Use Glitch MCP to set up local social asset folders for this game project.

Optional arguments I provided: $ARGUMENTS

If no title is selected, call `glitch_list_titles` and ask me which title to use.
Use the current project root if available; otherwise ask me for `project_root`.
Call `glitch_setup_social_asset_folders` with `confirm=true`, then call `glitch_scan_local_social_assets`.
Summarize the scan candidates and do not upload anything until I explicitly approve which assets to send.

