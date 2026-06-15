# Hosted Glitch MCP Facade Contract

The public adapter calls these hosted routes on the existing Glitch API backend. The backend enforces subscription, title access, token scopes, and guardrails.

Base URL:

```text
https://api.glitch.fun/api
```

## Headers

Requests from the public adapter include:

```text
Authorization: Bearer <token>      # user JWT or title-scoped MCP token
Accept: application/json
Content-Type: application/json      # when body is present
User-Agent: glitch-mcp/<version>
X-Glitch-MCP-Version: <version>
X-Glitch-MCP-Client: <client name>
```

Future OAuth-backed hosted MCP requests should use the access token supplied by the MCP client.

## Response Shape

Preferred success envelope:

```json
{
  "data": {}
}
```

The adapter also accepts raw JSON objects, but the envelope is recommended.

Preferred error envelope:

```json
{
  "message": "Subscription required.",
  "billing_url": "https://app.glitch.fun/agents/titles/title_123/billing",
  "dashboard_url": "https://app.glitch.fun/agents/titles/title_123",
  "errors": {}
}
```

## Routes

```text
GET  /mcp/v1/auth/status
GET  /mcp/v1/titles
GET  /mcp/v1/titles/{title_id}/context
GET  /mcp/v1/titles/{title_id}/billing
POST /mcp/v1/titles/{title_id}/runs
GET  /mcp/v1/titles/{title_id}/runs/{run_id}
GET  /mcp/v1/titles/{title_id}/runs/{run_id}/events
GET  /mcp/v1/titles/{title_id}/runs/{run_id}/stream
GET  /mcp/v1/titles/{title_id}/runs/{run_id}/report
GET  /mcp/v1/titles/{title_id}/runs/{run_id}/artifacts
GET  /mcp/v1/titles/{title_id}/actions
POST /mcp/v1/titles/{title_id}/actions/{action_id}/approve
POST /mcp/v1/titles/{title_id}/actions/{action_id}/reject
POST /mcp/v1/titles/{title_id}/actions/{action_id}/execute
GET  /mcp/v1/titles/{title_id}/guidance
POST /mcp/v1/titles/{title_id}/guidance/{guidance_id}/answer
POST /mcp/v1/titles/{title_id}/uploads
POST /mcp/v1/titles/{title_id}/files
POST /mcp/v1/titles/{title_id}/media
GET  /mcp/v1/titles/{title_id}/tokens
POST /mcp/v1/titles/{title_id}/tokens
DELETE /mcp/v1/titles/{title_id}/tokens/{token_id}
```

## Route Mapping

The facade is now implemented directly in Laravel and reuses the existing agent domain layer. Upload instructions point to the MCP facade upload route so user JWTs and title-scoped MCP tokens can both complete the multipart upload:

```text
POST /api/mcp/v1/titles/{title_id}/files
POST /api/mcp/v1/titles/{title_id}/media
```

The backend stores uploaded images, videos, and documents with the same attachment model used by the browser agent UI. Files are capped at 50 MB, validated by extension/mime type, and marked as reference material behind the prompt-injection boundary. The facade hides internal route catalog details and only returns safe MCP-facing payloads.

`/media` is for reviewed developer social assets. It accepts multipart field `media`, creates a `Media` record, queues the existing image/video AI processing jobs, and stores MCP scheduler metadata. If `create_title_update` is true, callers must provide `title_promotion_schedule_id`; the backend returns a conflict with dashboard/scheduler links instead of guessing a calendar. Repeated uploads are deduped by SHA-256 source hash for the same title. Non-MP4 videos are converted through the same media upload conversion path so downstream AI receives MP4 media. When AI processing completes, Glitch can promote the processed media into a scheduler-owned `TitleUpdate` library item and use the existing `OpenAIApiService` social copy system to write platform-specific text for later scheduling jobs.

The optional SSE route streams user-visible run progress as `text/event-stream`:

```text
event: status
event: run_event
event: heartbeat
event: settled
event: timeout
```

Clients should treat SSE as progressive enhancement and fall back to `GET /runs/{run_id}` plus `GET /events` polling.

## Required Server-Side Metadata

Each response should include stable IDs and links where possible:

```json
{
  "data": {
    "id": "run_123",
    "title_id": "title_123",
    "status": "completed",
    "is_terminal": true,
    "is_paused": false,
    "is_settled": true,
    "dashboard_url": "https://app.glitch.fun/agents/titles/title_123?run=run_123"
  }
}
```

Run payloads carry lifecycle flags so clients never re-derive the status taxonomy:

- `is_terminal` — reached a terminal status (`completed`, `failed`, `blocked`, `canceled`, `stopped`).
- `is_paused` — paused waiting on the user (`needs_guidance`, `needs_approval`, `waiting`, `paused`).
- `is_settled` — `is_terminal || is_paused`; the run will not advance without user input or a new run. `glitch_wait_for_agent_run` stops polling when this is true.

## Status Codes

```text
200 success
202 accepted/queued
400 bad input
401 auth required
402 subscription or payment required
403 title/scope denied
404 missing title/run/action/guidance
409 invalid state transition
422 validation error
429 rate limited
500 internal hosted service error
503 temporary Glitch service unavailable
```
