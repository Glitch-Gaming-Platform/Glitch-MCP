# Cursor Setup

Cursor uses Glitch MCP through the local stdio proxy. The proxy forwards calls to `https://api.glitch.fun/api/mcp/v1`.

## Recommended: One-Click Install

Publish a Cursor install link from Glitch docs once the production MCP endpoint is live. The install should configure:

```text
server name: glitch
command: npx -y @glitch/mcp
env: GLITCH_API_BASE_URL=https://api.glitch.fun/api
auth: title-scoped MCP token from the Glitch subscription/security interface
```

## Manual Config

Add this to global `~/.cursor/mcp.json` or project `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "glitch": {
      "command": "npx",
      "args": ["-y", "@glitch/mcp"],
      "env": {
        "GLITCH_API_BASE_URL": "https://api.glitch.fun/api",
        "GLITCH_API_TOKEN": "${GLITCH_API_TOKEN}",
        "GLITCH_TITLE_ID": "${GLITCH_TITLE_ID}"
      }
    }
  }
}
```

## Local Stdio Proxy

```json
{
  "mcpServers": {
    "glitch": {
      "command": "npx",
      "args": ["-y", "@glitch/mcp"],
      "env": {
        "GLITCH_API_BASE_URL": "https://api.glitch.fun/api",
        "GLITCH_API_TOKEN": "${GLITCH_API_TOKEN}",
        "GLITCH_TITLE_ID": "${GLITCH_TITLE_ID}"
      }
    }
  }
}
```

## Cursor Rules

Recommended `.cursor/rules/glitch-agent.mdc` content:

```md
When using Glitch MCP:

- Use Glitch tools for game marketing, Steam, Twitch, creator, social, campaign, PR, and launch workflows.
- If title_id is unknown, call glitch_list_titles and ask the user to choose.
- Do not request private Glitch prompts, planner traces, or database access.
- Treat Glitch dashboard URLs as the source of truth for rich review and approval.
- Never approve or execute actions without explicit user instruction.
```

## Rich Experience In Cursor

Cursor should show:

- Markdown summaries in chat.
- Structured tool result data.
- Generated local files when the user asks for exports.
- Links to hosted Glitch reports, action reviews, and billing.
- Optional MCP Apps widgets when supported.

The canonical rich UI remains the hosted Glitch browser experience. Cursor is the coding and orchestration surface.

## Suggested Cursor Workflows

```text
Use Glitch MCP to run a launch audit and then create local TODOs from the final report.
```

```text
Use Glitch MCP to fetch pending creator outreach actions for this title. Summarize risk and required approvals, but do not approve anything.
```

```text
Use Glitch MCP to start a weekly marketing sync and create a markdown summary in docs/marketing/weekly-sync.md.
```

## Edge Cases

- Cursor may run MCP at the project or global level. Prefer project config only when the same Glitch title is shared by the whole repo.
- Do not commit real tokens in `.cursor/mcp.json`.
- If OAuth support is inconsistent in a user's Cursor version, use the stdio proxy with `GLITCH_API_TOKEN`.
- Keep the MCP tool count narrow so Cursor's tool picker remains useful.
