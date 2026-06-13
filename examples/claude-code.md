# Claude Code Examples

Local stdio proxy:

```bash
export GLITCH_API_BASE_URL="https://api.glitch.fun/api"
export GLITCH_API_TOKEN="gl_mcp_..."
export GLITCH_TITLE_ID="title_..."
claude mcp add glitch -- npx -y @glitch/mcp
```

Suggested prompt:

```text
Use Glitch MCP to run a launch audit for the selected title. Wait for completion, fetch the final report, then list pending actions without approving or executing anything.
```
