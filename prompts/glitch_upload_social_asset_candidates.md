---
description: Upload selected social asset candidates to Glitch Media.
argument-hint: project_root candidate_ids=<ids> [title_id] [schedule_id]
---

Use Glitch MCP tool `glitch_upload_social_asset_candidates` to upload selected local scan candidates to Glitch as Media.

Arguments I provided: $ARGUMENTS

Use provided project root, candidate ids, file paths, title id, platforms, and title promotion schedule id when clear.
Set `confirm=true` only when my command explicitly approves uploading. If upload intent, candidate ids, file paths, or required scheduler information is unclear, ask before uploading.
When `create_title_updates=true`, require `title_promotion_schedule_id`; do not guess among calendars.
After uploading, summarize uploaded media and any scheduler/library updates.

