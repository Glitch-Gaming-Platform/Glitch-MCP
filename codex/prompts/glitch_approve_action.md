---
description: Approve a reviewable Glitch action after explicit confirmation.
argument-hint: action_id [title_id] [note]
---

Use Glitch MCP tool `glitch_approve_action` only if this command clearly includes my explicit instruction to approve the action.

Arguments I provided: $ARGUMENTS

Treat the first action-like id as `action_id`. Use a provided title id and note if present.
Set `confirm=true` only when my command explicitly says to approve. If approval intent is unclear, show the action details first and ask me to confirm.
After approval, summarize what was approved and whether it still needs execution.

