---
description: Upload approved local social assets to Glitch Media.
argument-hint: [title_id] [project_root] [candidate_ids] [title_promotion_schedule_id]
---

Use Glitch MCP to upload reviewed local social assets as Media.

Optional arguments I provided: $ARGUMENTS

If no title is selected, call `glitch_list_titles` and ask me which title to use.
Use the current project root if available; otherwise ask me for `project_root`.
Ask me which candidate ids to upload if I did not provide them.
Ask me for `title_promotion_schedule_id` before uploading assets that should create scheduler library TitleUpdates.
Call `glitch_upload_social_asset_candidates` only after explicit approval and with `confirm=true`.
These uploads should become Media first. After Media AI analysis completes, Glitch can create scheduler library TitleUpdates and use the existing social copy system for platform-specific text.

