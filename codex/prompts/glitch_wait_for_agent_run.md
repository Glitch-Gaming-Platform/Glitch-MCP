---
description: Wait for a Glitch Agent run to finish or pause.
argument-hint: run_id [title_id] [timeout_ms]
---

Use Glitch MCP tool `glitch_wait_for_agent_run` to wait for a Glitch Agent run until it completes, pauses for approval/guidance, fails, or is canceled.

Arguments I provided: $ARGUMENTS

Treat the first run-like id as `run_id`. Use a provided title id and timeout if present.
If `run_id` is missing, ask me for it.
When the wait ends, summarize the final status and fetch the final report if one is available.

