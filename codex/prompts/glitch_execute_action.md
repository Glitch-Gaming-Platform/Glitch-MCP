---
description: Execute an approved Glitch action after explicit confirmation.
argument-hint: action_id [title_id] [note]
---

Use Glitch MCP tool `glitch_execute_action` only if this command clearly includes my explicit instruction to execute the already-approved action.

Arguments I provided: $ARGUMENTS

Treat the first action-like id as `action_id`. Use a provided title id and note if present.
Set `confirm=true` only when my command explicitly says to execute. If execution intent is unclear, show the action details first and ask me to confirm.
After execution, summarize the result and any public, paid, or creator-facing effects reported by Glitch.

