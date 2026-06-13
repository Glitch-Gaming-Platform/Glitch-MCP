# Authentication And Title Access

Glitch MCP is designed for a paid hosted service. Developers can install the public adapter, but every meaningful call is authorized and billed by Glitch servers.

## Recommended Flow: Title MCP Token

The implemented public distribution path uses the local MCP adapter plus the hosted Glitch API facade.

1. Developer subscribes in the Glitch browser UI.
2. Developer opens the title security/subscription interface.
3. Glitch creates a title-scoped MCP token and shows the full token once.
4. Developer sets `GLITCH_API_TOKEN` and `GLITCH_TITLE_ID` in Codex, Cursor, Claude Code, or another MCP client.
5. The public adapter calls `https://api.glitch.fun/api/mcp/v1`.
6. Every MCP tool call re-checks auth, subscription, title access, scope, risk, and rate limits.

The token stores only a hash server-side, includes an audit user, and is revocable without exposing private planner, route, billing, or executor code.

## Optional OAuth (implemented, off by default)

The HTTP transport can advertise OAuth so MCP clients discover an authorization server instead of pasting a token. OAuth is **opt-in** — bearer-token auth keeps working unchanged when it is disabled.

Enable it with:

```bash
export GLITCH_MCP_OAUTH_ENABLED=true
export GLITCH_MCP_OAUTH_ISSUER="https://auth.glitch.fun"        # authorization server
export GLITCH_MCP_OAUTH_RESOURCE_URL="https://mcp.glitch.fun/mcp" # this resource server
export GLITCH_MCP_OAUTH_SCOPES="runs:read,runs:create,actions:read"
```

When enabled, `glitch-mcp http`:

- serves OAuth 2.0 Protected Resource Metadata (RFC 9728) at `/.well-known/oauth-protected-resource`, and
- answers unauthenticated `POST /mcp` with `401` and `WWW-Authenticate: Bearer resource_metadata="…"` so clients can begin the OAuth flow.

Token verification still happens at the hosted Glitch facade — the adapter only forwards the bearer. If Glitch deploys a managed gateway, keep it on the same API domain (e.g. `https://api.glitch.fun/mcp`) with the REST facade at `https://api.glitch.fun/api/mcp/v1`.

## HTTP Transport Hardening

- `GLITCH_MCP_ALLOWED_HOSTS` — comma-separated hostnames allowed for DNS-rebinding protection when binding to `0.0.0.0`/`::`.
- `GLITCH_MCP_RATE_LIMIT_PER_MINUTE` — optional in-memory edge rate limit per credential (per bearer token, else per IP). `0`/unset disables it; the hosted facade remains the authoritative limiter.
- `GLITCH_MCP_ALLOW_LOCAL_FILE_READS` — override whether `glitch_upload_file` may read local `file_path`s. Defaults on for stdio, off for the shared HTTP server.
- `GLITCH_MCP_UPLOAD_ALLOWED_ROOTS` — optional comma-separated directory allow-list for stdio `file_path` uploads. When set, the adapter resolves real paths and refuses files outside those roots.

## How The Adapter Resolves The Token Per Transport

The adapter never trusts a credential locally — it forwards one to the hosted facade, which performs every check.

- **stdio mode** (one developer, one process): the token comes from `GLITCH_API_TOKEN` / `GLITCH_MCP_TOKEN` and is sent as `Authorization: Bearer <token>` on every hosted call.
- **Streamable HTTP mode** (`glitch-mcp http`, multi-caller): the adapter reads the **incoming request's** `Authorization: Bearer` header and forwards *that* token to Glitch for the duration of the request. This makes the HTTP transport multi-tenant safe — each caller authenticates as themselves rather than sharing the operator's configured token. If a request omits the header, the adapter falls back to the configured token (handy for a single-tenant self-hosted proxy) and otherwise the hosted facade returns `authentication_required`.

In both modes the resolved bearer is the only thing sent upstream; the facade re-checks subscription, title scope, abilities, risk, and rate limits on every call.

## Title MCP Token Properties

Title MCP tokens are not bypass tokens. They are scoped service credentials that still require active subscription state.

Recommended key properties:

- Created from Glitch UI by a title owner or workspace admin.
- Scoped to one title by default.
- Optional multi-title keys only for workspace admins.
- Expire by default after 30 or 90 days.
- Shown once.
- Stored hashed server-side.
- Revocable from the title billing/security page.
- Audited on every tool call.
- Never grant raw database, prompt, planner, or executor access.

Implemented abilities:

```text
titles:read
context:read
billing:read
runs:read
runs:create
events:read
reports:read
artifacts:read
guidance:read
guidance:answer
actions:read
actions:approve
actions:execute
uploads:create
```

Token presets:

```text
readonly  = read/report/artifact/action/guidance inspection only
operator  = readonly + runs:create + guidance:answer + uploads:create
developer = all MCP abilities
```

`actions:approve` and `actions:execute` are deliberately separate abilities so teams can create non-executing tokens for agents that only inspect reports.

## Environment Variables

```bash
export GLITCH_API_BASE_URL="https://api.glitch.fun/api"
export GLITCH_API_TOKEN="gl_mcp_..."
export GLITCH_TITLE_ID="title_..."
export GLITCH_DASHBOARD_URL="https://app.glitch.fun"
```

`GLITCH_TITLE_ID` is a convenience only. Tools still accept explicit `title_id`. The adapter also supports legacy aliases `GLITCH_MCP_URL`, `GLITCH_MCP_TOKEN`, and `GLITCH_MCP_DEFAULT_TITLE_ID`.

## Server-Side Checks

Every hosted Glitch MCP request should verify:

```text
token/session is valid
token/session has not expired
workspace is active
title belongs to workspace
user or key has title access
subscription/trial/credits allow the requested tool
scope allows the requested tool
rate limit has not been exceeded
connected account requirements are satisfied
risk level is allowed by title policy
human approval exists when required
```

## Error Contracts

The hosted service should return clear, structured errors:

```json
{
  "message": "This title needs an active Glitch Agent subscription.",
  "billing_url": "https://app.glitch.fun/agents/titles/title_123/billing"
}
```

HTTP status mapping:

```text
401 authentication_required
402 subscription_required
403 permission_denied
404 not_found
409 conflict
422 validation_error
429 rate_limited
5xx upstream_error
```

The public adapter maps these to sanitized MCP tool errors.

## Token Rotation

Recommended Glitch UI actions:

- Create key.
- Revoke key.
- Rotate key.
- View last used time.
- View last used client.
- View scope list.
- View recent MCP calls.
- Alert on first use from a new geography or client family.

## Lost Or Leaked Token

1. Revoke key from Glitch UI.
2. Review recent MCP audit log.
3. Rotate connected platform credentials if a risky action executed.
4. Create a new key with the minimum scope required.
5. Prefer OAuth for future use.
