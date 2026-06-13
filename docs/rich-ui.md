# Rich Interactive Experience

Glitch MCP should feel rich without assuming every MCP host can render inline apps.

Use progressive enhancement:

1. **Universal MCP result**
   Markdown summary, structured JSON, resource links.
2. **Hosted Glitch UI**
   Full browser experience for authenticated workflows.
3. **MCP Apps widget**
   Inline interactive UI where the host supports MCP Apps.

## UX Matrix

| Feature | Codex | Cursor | Claude Code | Hosted Glitch |
| --- | --- | --- | --- | --- |
| Start agent run | MCP tool | MCP tool | MCP tool | Full UI |
| Live run timeline | Structured result + link | Structured result + link | Markdown + link | Rich timeline |
| Final report | Markdown + JSON + link | Markdown + JSON + link | Markdown + JSON + link | Full dashboard |
| Approval queue | Tool cards + prompt approval | Tool cards + IDE chat | Terminal cards | Rich queue |
| Guidance forms | Tool data + link | Tool data + link | Tool data + link | Full forms |
| Draft editing | Link to Glitch | Link to Glitch | Link to Glitch | Rich editor |
| Media preview | Link/artifact | Link/artifact | Link/artifact | Gallery |
| Billing | Link only | Link only | Link only | Billing UI |
| Connected accounts | Link only | Link only | Link only | OAuth/account UI |
| Inline MCP Apps | Future/progressive | Capability-detected | Capability-detected | Not needed |

## Widgets To Build

These widgets should live in `packages/widgets` or the hosted Glitch app and be advertised through MCP Apps metadata when supported.

### Run Status Timeline

Inputs:

```json
{
  "title_id": "title_123",
  "run_id": "run_123",
  "status": "running",
  "events": []
}
```

Actions:

- Refresh run.
- Open hosted run.
- Show pending guidance.
- Show pending approvals.

### Final Report Dashboard

Inputs:

```json
{
  "run_id": "run_123",
  "final_report": {},
  "artifacts": []
}
```

Actions:

- Open full report.
- Download artifact.
- Copy executive summary.
- Create follow-up run.

### Approval Queue

Inputs:

```json
{
  "title_id": "title_123",
  "actions": []
}
```

Actions:

- View action detail.
- Reject action.
- Open Glitch approval screen.
- Approve only when host supports explicit confirmation.

### Guidance Form

Inputs:

```json
{
  "guidance_id": "guidance_123",
  "question": "What monthly ad budget should we use?",
  "schema": {}
}
```

Actions:

- Submit answer.
- Open full Glitch form.

### Billing Card

Inputs:

```json
{
  "title_id": "title_123",
  "subscription_status": "required",
  "billing_url": "https://app.glitch.fun/..."
}
```

Actions:

- Open billing.
- Show plan limits.

## Host-Specific UX

### Codex

Codex should be treated as the orchestration surface. Return structured cards and links. Use the hosted dashboard for authenticated UI, especially billing, connected accounts, draft editing, and approvals.

### Cursor

Cursor should be treated as the IDE surface. Return concise summaries, structured data, and links. Let Cursor create local docs or TODOs from Glitch reports when the user asks.

### Claude Code

Claude Code should be treated as the terminal agent surface. Return compact Markdown tables, risk summaries, and links. Keep rich forms in the browser.

## Fallback Rules

- If inline widgets are unsupported, return Markdown + structured JSON + dashboard URL.
- If hosted UI requires login, open the normal browser.
- If a client cannot open browser links, return the URL visibly.
- If a report has large tables, return a summary plus artifact links.
- If a token lacks title scope, return a clear access error and link to Glitch token settings.

## Browser Experience Links

Recommended deep links:

```text
/agents/titles/{title_id}
/agents/titles/{title_id}?run={run_id}
/agents/titles/{title_id}?action={action_id}
/agents/titles/{title_id}/billing
/agents/titles/{title_id}/connections
/agents/titles/{title_id}/artifacts/{artifact_id}
```

These links should be stable because all clients depend on them for the rich experience.
