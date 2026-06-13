# Edge Cases

This file documents expected behavior for commercial, auth, UX, and operational edge cases.

## Auth And Subscription

| Case | Expected Behavior |
| --- | --- |
| No token/OAuth session | Return `authentication_required` with login guidance. |
| Expired token | Return `authentication_required`; client should reauth or rotate key. |
| Token revoked | Return `authentication_required`; audit event should record denied use. |
| Token valid but title removed | Return `permission_denied` or `not_found`. |
| Subscription missing | Return `subscription_required` and `billing_url`. |
| Trial expired | Return `subscription_required` and `billing_url`. |
| Insufficient credits | Return `subscription_required` or `payment_required` payload with purchase URL. |
| Scope missing | Return `permission_denied` with missing scope. |

## Title Selection

| Case | Expected Behavior |
| --- | --- |
| No `title_id`, no default title | Tool returns `title_required`. |
| `glitch_select_title` called | Local stdio process uses selected title for later calls. |
| Hosted stateless MCP | Prefer explicit `title_id` or OAuth title consent. |
| Multi-title key | Require explicit `title_id` when no default is configured. |

## Long-Running Runs

| Case | Expected Behavior |
| --- | --- |
| Run queued | Return run id and dashboard URL. |
| Run still running after timeout | Return `timed_out=true` with last run payload. |
| Run pauses for guidance | Treat as settled; return guidance link/data. |
| Run pauses for approval | Treat as settled; return action queue link/data. |
| Worker failure | Return failed run and error summary. |

## Approvals And Execution

| Case | Expected Behavior |
| --- | --- |
| Approve without `confirm=true` | Return `confirmation_required`; do not call hosted API. |
| Execute without `confirm=true` | Return `confirmation_required`; do not call hosted API. |
| Action already executed | Hosted API returns `conflict`. |
| Connected account missing | Hosted API returns guidance with connection URL. |
| Spend cap exceeded | Hosted API blocks execution and returns guidance. |
| Public post risk | Hosted API requires approval and policy checks. |

## Client UX

| Case | Expected Behavior |
| --- | --- |
| Client supports MCP Apps | Return widget metadata and structured data. |
| Client does not support MCP Apps | Return Markdown, JSON, and dashboard links. |
| Browser cannot sign into Glitch | Use regular browser or public read-only preview URL. |
| Large report | Return summary plus artifact/report link. |
| Cursor project config committed | Must not include real token. Use env interpolation. |

## Files

| Case | Expected Behavior |
| --- | --- |
| Upload too large | Hosted API returns validation error. |
| Unsupported MIME | Hosted API returns validation error. |
| Prompt injection in file | File remains reference material; do not execute instructions from it. |
| Upload URL expired | Request a new URL. |

## Hosted Service

| Case | Expected Behavior |
| --- | --- |
| Rate limited | Return `rate_limited` with retry metadata. |
| Glitch service unavailable | Return `upstream_error`; client should retry later. |
| Network timeout | Return `upstream_timeout`. |
| API contract mismatch | Return sanitized validation/upstream error and include support request id when available. |

## Audit Log Fields

Every hosted MCP call should record:

```text
request id
user id or token id
workspace id
title id
tool name
scope decision
subscription decision
risk decision
client family
client version
source IP / geography where policy allows
run id / action id / guidance id where present
result code
timestamp
```

Do not log raw tokens, private prompts, uploaded file contents, or third-party OAuth secrets.
