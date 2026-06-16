---
description: Start a Glitch Agent run for a title.
argument-hint: [title_id] prompt="<task>"
---

Use Glitch MCP tool `glitch_start_agent_run` to start a Glitch Agent run.

Arguments I provided: $ARGUMENTS

Use my arguments as the task prompt and title/run options when they are clear.
If no title is selected, call `glitch_list_titles` and ask me which title to use.
If the task prompt is missing or ambiguous, ask me for the task before starting the run.
By default, queue the run in the background unless I explicitly ask you to wait for completion.
After starting, return the run id, status, and dashboard link if available.

