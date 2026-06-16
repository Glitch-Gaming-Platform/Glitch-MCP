---
description: Start the Glitch local social asset watcher.
argument-hint: [title_id] [project_root] [interval_hours]
---

Use Glitch MCP to activate the local social asset watcher for this game project.

Optional arguments I provided: $ARGUMENTS

If no title is selected, call `glitch_list_titles` and ask me which title to use.
Use the current project root if available; otherwise ask me for `project_root`.
Call `glitch_start_social_asset_watch` with `confirm=true`.
This should only scan and update the local candidate manifest; do not upload anything without explicit approval.

