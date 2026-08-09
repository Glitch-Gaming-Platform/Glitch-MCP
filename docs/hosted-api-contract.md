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
  "billing_url": "https://www.glitch.fun/agents/titles/title_123/billing",
  "dashboard_url": "https://www.glitch.fun/agents/titles/title_123",
  "errors": {}
}
```

## Routes

```text
GET  /mcp/v1/auth/status
GET  /util/genres
POST /tools/game-design/blueprint
GET  /mcp/v1/titles
GET  /mcp/v1/titles/{title_id}/context
GET  /mcp/v1/titles/{title_id}/billing
GET  /mcp/v1/titles/{title_id}/analytics/capabilities
POST /mcp/v1/titles/{title_id}/analytics/query
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
POST /mcp/v1/titles/{title_id}/hosting/domains/check
POST /mcp/v1/titles/{title_id}/hosting/sites/{site_id}/domains/purchase
POST /mcp/v1/titles/{title_id}/hosting/billing/checkout
POST /mcp/v1/titles/{title_id}/hosting/billing/confirm
GET  /mcp/v1/titles/{title_id}/hosting/sites/{site_id}/databases
POST /mcp/v1/titles/{title_id}/hosting/sites/{site_id}/databases
GET  /mcp/v1/titles/{title_id}/hosting/sites/{site_id}/databases/{database_id}
PUT  /mcp/v1/titles/{title_id}/hosting/sites/{site_id}/databases/{database_id}
POST /mcp/v1/titles/{title_id}/hosting/sites/{site_id}/databases/{database_id}/retry
DELETE /mcp/v1/titles/{title_id}/hosting/sites/{site_id}/databases/{database_id}
GET  /mcp/v1/titles/{title_id}/hosting/sites/{site_id}/services
POST /mcp/v1/titles/{title_id}/hosting/sites/{site_id}/services/estimate
POST /mcp/v1/titles/{title_id}/hosting/sites/{site_id}/services/apply
GET  /mcp/v1/titles/{title_id}/social/capabilities
POST /mcp/v1/titles/{title_id}/social/operations/{operation}
GET  /mcp/v1/titles/{title_id}/tokens
POST /mcp/v1/titles/{title_id}/tokens
DELETE /mcp/v1/titles/{title_id}/tokens/{token_id}
```

## Public Game-Development Routes

The prompt catalog itself is bundled in the public MCP package so prompt
discovery and retrieval do not require a backend call. The generator uses two
existing public Glitch API routes and does not require `title_id`:

```text
GET  /util/genres
POST /tools/game-design/blueprint
```

`GET /util/genres` returns the complete alphabetized platform genre collection.
The MCP preserves each genre object and presents its `name` for multi-select use.

`POST /tools/game-design/blueprint` accepts:

```json
{
  "gameName": "Signal Garden",
  "genre": "cozy",
  "genres": ["Cozy", "Puzzle"],
  "playMode": "cooperative",
  "sessionLength": "15–30 minute",
  "playerFantasy": "two signal gardeners reconnecting isolated communities",
  "setting": "floating islands where radio signals grow as plants",
  "primaryGoal": "restore the shared broadcast before the seasonal storm",
  "mainPressure": "signals decay while each island asks for different help",
  "signatureTwist": "tuning one signal changes every nearby plant",
  "progression": "unlock new instruments and signal seeds",
  "preferredActivities": "listen, tune, plant, connect"
}
```

`genres` accepts one to eight exact genre names. `genre` is the deterministic
fallback profile derived from the first selected genre for compatibility with
older clients. The response includes `descriptor`, `coreFantasy`, `coreVerbs`,
`pillars`, `mechanics`, `coreLoop`, `sessionLoop`, `coreTest`, `scopeRules`,
`documentationInstruction`, and `ai_used`.

OpenAI-backed generation can take about a minute. The adapter uses a minimum
two-minute HTTP timeout for this route and emits MCP progress/log notifications
so compatible clients can keep a visible running state. Until the route is
available in a target environment, or whenever it fails, the public MCP package
uses its bundled deterministic generator and returns `ai_used: false` with the
same required documentation destination.

The adapter also uses existing title-scoped Hosting routes for non-billing
operations. Those routes accept a matching MCP title token and enforce
`hosting:read`, `hosting:deploy`, or `hosting:promote`:

```text
GET  /titles/{title_id}/hosting
GET  /titles/{title_id}/hosting/analytics/channels
POST /titles/{title_id}/hosting/sites
PUT  /titles/{title_id}/hosting/sites/{site_id}
GET  /titles/{title_id}/hosting/sites/{site_id}/releases
POST /titles/{title_id}/hosting/sites/{site_id}/releases
POST /titles/{title_id}/hosting/sites/{site_id}/releases/{release_id}/promote
POST /titles/{title_id}/hosting/sites/{site_id}/domains
POST /titles/{title_id}/hosting/sites/{site_id}/domains/{domain_id}/verify
POST /titles/{title_id}/hosting/sites/{site_id}/ai-instructions
GET  /titles/{title_id}/hosting/sites/{site_id}/services
POST /titles/{title_id}/hosting/sites/{site_id}/services/estimate
POST /titles/{title_id}/hosting/sites/{site_id}/services/apply
```

## Route Mapping

The facade is now implemented directly in Laravel and reuses the existing agent domain layer. Upload instructions point to the MCP facade upload route so user JWTs and title-scoped MCP tokens can both complete the multipart upload:

```text
POST /api/mcp/v1/titles/{title_id}/files
POST /api/mcp/v1/titles/{title_id}/media
```

The backend stores uploaded images, videos, and documents with the same attachment model used by the browser agent UI. Files are capped at 50 MB, validated by extension/mime type, and marked as reference material behind the prompt-injection boundary. The facade hides internal route catalog details and only returns safe MCP-facing payloads.

`/media` is for reviewed developer social assets. It accepts multipart field `media`, creates a `Media` record, queues the existing image/video AI processing jobs, and stores MCP scheduler metadata. If `create_title_update` is true, callers must provide `title_promotion_schedule_id`; the backend returns a conflict with dashboard/scheduler links instead of guessing a calendar. Repeated uploads are deduped by SHA-256 source hash for the same title. Non-MP4 videos are converted through the same media upload conversion path so downstream AI receives MP4 media. When AI processing completes, Glitch can promote the processed media into a scheduler-owned `TitleUpdate` library item and use the existing `OpenAIApiService` social copy system to write platform-specific text for later scheduling jobs.

The social capability route returns the current platform matrix, safe connected-scheduler summaries, granular ability requirements, confirmation requirements, and the complete operation catalog. The operation route accepts:

```json
{
  "arguments": {},
  "confirm": false
}
```

The backend validates every scheduler, post, comment, conversation, update, destination, media, and statistics record against the title before delegating to the existing social controllers and facades. It rejects credential-shaped input and recursively redacts credentials from successful and failed responses. Mutating operations require `confirm=true`; read operations do not.

The analytics capability route returns the canonical report registry shared by
MCP and the Title Agent. The query route accepts either a family bundle or an
explicit `reports` array:

```json
{
  "family": "sessions",
  "report_keys": ["sessions.average", "retention.d7"],
  "filters": {
    "start_date": "2026-07-01",
    "end_date": "2026-08-01"
  },
  "report_filters": {
    "retention.d7": {
      "platform": "steam"
    }
  },
  "fail_fast": false
}
```

The backend authorizes the title and `reports:read` ability, bounds report
count/date/page sizes, and invokes the existing dashboard controllers under the
authorized title administrator. Responses are recursively normalized and
secret-redacted. Without the separate `reports:identity` ability, raw user,
install, device, session, fingerprint, IP, user-agent, cookie, and related
identity fields are also removed; identity-valued applied filters are returned
as `[redacted]`. Each report keeps its own status, applied filters, ignored
filters, and error so missing optional context or empty data produces a partial
bundle instead of an opaque server failure.

## Hosting Payment And Provisioning Boundary

MCP never accepts card numbers, payment-provider secret keys, hosting-provider
credentials, database passwords, or DNS-provider credentials. Paid Hosting calls use the audited user who
created the title token, require title administration plus community billing
permission, and require `confirm=true`.

Database owners may reveal their own ready database credentials only through
the signed-in Hosting dashboard. The user route requires business billing
permission and exact-name confirmation, is rate-limited and non-cacheable, and
writes a secret-free audit record. No MCP tool proxies that response, which
keeps database passwords and connection strings out of model context and MCP
client logs.

Plan, database, and domain requests include the price the developer reviewed
and a case-sensitive confirmation phrase. The backend compares both against its
current catalog or live availability response. Active subscription changes
also require `accept_proration=true`. A mismatch returns `409` before billing or
hosting state is changed.

Complex service deployment uses the same boundary. Estimation is read-only.
Apply requires the current always-on monthly floor and an exact confirmation
that additional scale-out, requests, and job runtime remain usage based.
Service manifests may contain ordinary settings but reject secret-shaped keys.
There is no MCP route for setting or revealing service secret values.

New paid resources return a secure-checkout URL. The confirm endpoint retrieves
the session from the payment provider, verifies that the checkout order belongs to the
selected title/community and audited creator, and begins setup only after
the provider reports completed payment. Managed-domain price is rechecked in the
same request that creates Checkout to prevent a price-change race.

Database resources expose only safe metadata: status, engine, plan, storage,
endpoint, port, and binding name. Encrypted connection configuration, secret
references, passwords, and complete connection strings are not serialized.
Deletion requires both `confirm=true` and an exact database-name match.

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
    "dashboard_url": "https://www.glitch.fun/agents/titles/title_123?run=run_123"
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
