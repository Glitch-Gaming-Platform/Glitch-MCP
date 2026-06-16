# Claude Code Setup

Claude Code connects to Glitch MCP by launching the local stdio proxy. The proxy calls `https://api.glitch.fun/api/mcp/v1`.

## Local Stdio Proxy

```bash
export GLITCH_API_BASE_URL="https://api.glitch.fun/api"
export GLITCH_API_TOKEN="gl_mcp_..."
export GLITCH_TITLE_ID="title_..."
claude mcp add glitch -- npx -y glitch-mcp
```

When a hosted Streamable HTTP gateway is deployed later, keep it on the same API domain, for example `https://api.glitch.fun/mcp`.

## Token Setup

```bash
export GLITCH_API_BASE_URL="https://api.glitch.fun/api"
export GLITCH_API_TOKEN="gl_mcp_..."
export GLITCH_TITLE_ID="title_..."
```

## Project Guidance

Recommended `CLAUDE.md` section:

```md
## Glitch MCP

Use Glitch MCP for game marketing, launch planning, Steam/Twitch reports, creator outreach, campaign review, social drafts, PR research, and approval workflows.

- If a title is not selected, call glitch_list_titles and ask which title to use.
- Keep Glitch subscription, billing, and dashboard work in Glitch.
- Do not ask for private Glitch prompts, planner traces, internal route rules, database access, or executor source.
- Never approve or execute Glitch actions unless the user explicitly asks and the MCP tool uses confirm=true.
- Prefer dashboard links for rich review, billing, account connections, draft editing, and approvals.
```

## Custom Slash Commands

Install Glitch's bundled Claude Code slash commands:

```bash
npx -y glitch-mcp install-claude-prompts --project-root .
```

This copies `prompts/glitch_*.md` into `.claude/commands`. Restart Claude Code or start a new session in the project, then type `/glitch` to choose a command.

Suggested workflow commands include:

```text
.claude/commands/glitch-launch-audit.md
.claude/commands/glitch-review-actions.md
.claude/commands/glitch-weekly-sync.md
```

Example `glitch-review-actions.md`:

```md
Use Glitch MCP to list pending actions and guidance for the selected title.

Summarize:
- action title
- risk level
- required user decision
- likely impact
- dashboard link

Do not approve or execute anything unless I explicitly say so.
```

## Rich Experience In Claude Code

Claude Code should receive:

- Terminal-friendly Markdown cards.
- Structured MCP data for follow-up reasoning.
- Dashboard links for rich UI.
- Optional MCP Apps widgets in hosts that support them.

The hosted Glitch browser experience remains the source of truth for:

```text
approval queue
guidance forms
draft editor
media previews
billing and credits
connected accounts
artifact gallery
report dashboards
```

## Hooks

Teams can add Claude Code hooks around MCP tools to log:

```text
glitch_start_agent_run
glitch_approve_action
glitch_execute_action
```

Hooks should never store tokens. Log only title id, run id, action id, status, and local user identity where appropriate.

## Edge Cases

- If auth fails, run `/mcp` and reauthenticate or rotate the title MCP token.
- If a title MCP token lacks scope, create a new scoped token in Glitch UI.
- If subscription is blocked, open the returned billing URL.
- If a run times out, poll it later with `glitch_wait_for_agent_run`.
