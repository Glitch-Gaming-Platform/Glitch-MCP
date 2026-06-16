---
description: Answer a Glitch guidance request and resume workflow.
argument-hint: guidance_id answer="<answer>" [title_id]
---

Use Glitch MCP tool `glitch_answer_guidance` to answer a Glitch Agent guidance request and resume the server-side workflow when possible.

Arguments I provided: $ARGUMENTS

Treat the first guidance-like id as `guidance_id` and the rest as the answer, unless I clearly label fields differently.
If `guidance_id` or the answer is missing, ask me for the missing value.
After answering, summarize whether the workflow resumed and what happens next.

