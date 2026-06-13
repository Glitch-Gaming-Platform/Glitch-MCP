# Codex Setup

Codex uses the public Glitch MCP adapter as a local stdio server. The adapter forwards calls to the hosted Glitch API facade at `https://api.glitch.fun/api`.

## Recommended: Local Stdio Proxy

```toml
[mcp_servers.glitch]
command = "npx"
args = ["-y", "@glitch/mcp"]
env_vars = ["GLITCH_API_BASE_URL", "GLITCH_API_TOKEN", "GLITCH_TITLE_ID"]
default_tools_approval_mode = "prompt"
tool_timeout_sec = 120

[mcp_servers.glitch.tools.glitch_approve_action]
approval_mode = "prompt"

[mcp_servers.glitch.tools.glitch_execute_action]
approval_mode = "prompt"
```

Environment:

```bash
export GLITCH_API_BASE_URL="https://api.glitch.fun/api"
export GLITCH_API_TOKEN="gl_mcp_..."
export GLITCH_TITLE_ID="title_..."
```

The local proxy does not contain Glitch Agent logic. It only forwards MCP calls to the hosted Glitch facade.

Future hosted Streamable HTTP deployments should use the same API domain, for example `https://api.glitch.fun/mcp`.

## Recommended Codex Plugin Bundle

The Codex distribution should eventually ship as a plugin containing:

```text
plugin manifest
MCP server config
Glitch skill/workflow docs
launch audit prompt
Steam page review prompt
weekly marketing sync prompt
pending action review prompt
security guidance
```

## Rich Experience In Codex

Codex should receive:

- Structured MCP results.
- Markdown summaries.
- Resource links for reports and dashboards.
- Approval queue cards in structured content.
- Deep links to Glitch hosted UI.
- Optional MCP Apps metadata for future inline widget support.

Codex's Glitch Browser Experience should open:

```text
title workspace
agent run timeline
final report dashboard
approval queue
guidance form
billing screen
connected account checklist
artifact gallery
```

Use Glitch dashboard links for authenticated pages. Use short-lived public preview links only for read-only artifacts that need to open in browser surfaces without a signed-in session.

## Suggested Prompts

```text
Use Glitch MCP to list my titles, select the right title, run a launch readiness audit, wait for completion, and summarize the final report with dashboard links.
```

```text
Use Glitch MCP to review pending actions for this title. Group them by risk and required decision. Do not approve or execute anything until I explicitly say so.
```

```text
Use Glitch MCP to start a Steam page review for this game title. When it finishes, fetch the final report and artifacts.
```

## Edge Cases

- If no title is selected, call `glitch_list_titles`.
- If subscription is missing, show `billing_url` and stop.
- If a run is long-running, return the run id and poll with `glitch_wait_for_agent_run`.
- If an action needs approval, summarize it and link to Glitch UI.
- Never call `glitch_approve_action` or `glitch_execute_action` without explicit user instruction and `confirm=true`.
