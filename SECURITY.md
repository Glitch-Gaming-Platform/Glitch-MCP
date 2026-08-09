# Security Policy

Glitch MCP is a public adapter for a paid hosted service. The security model depends on keeping sensitive functionality on Glitch servers.

## Do Not Put These In This Repository

- Private planner prompts.
- Internal route-resolution logic.
- Model provider API keys.
- Billing enforcement code.
- Database credentials.
- Social, ad, creator, PR, Steam, Twitch, or Discord integration tokens.
- Raw customer data fixtures.
- Private agent memory dumps.
- Internal executor source.

The bundled AI Game Development Prompts are intentionally public editorial guidance from the Glitch website. They must remain clearly separated from private Glitch Agent planner prompts, internal tool-routing instructions, model credentials, and executor logic.

## Supported Auth

Preferred:

```text
OAuth against hosted Glitch MCP
```

Fallback:

```text
Title MCP Access Key via GLITCH_MCP_TOKEN
```

Title keys must be created, scoped, expired, audited, and revoked from the Glitch subscription interface.

## Required Server-Side Enforcement

The hosted Glitch service must check these on every request:

```text
authentication
workspace access
title access
subscription or trial
credit balance
tool scope
rate limits
action risk
approval state
connected-account state
policy stopgates
```

The public MCP package should never be trusted to enforce billing or permissions.

## Mutating Tool Safety

`glitch_approve_action` and `glitch_execute_action` require `confirm=true`. This is not a replacement for hosted Glitch guardrails. It is an extra local brake so a model cannot accidentally trigger an approval or execution from a vague prompt.

Hosting mutations use the same local brake. Paid or destructive Hosting tools
also require server-side safeguards:

- Exact current price and a case-sensitive confirmation phrase for plans, databases, and managed domains.
- Community billing permission in addition to title administration.
- Explicit proration acknowledgement for active paid subscription changes.
- Stripe Checkout for new paid resources; no payment credentials enter MCP.
- Stripe API confirmation before Azure provisioning begins.
- Exact database-name confirmation before deletion.
- Title/community/creator ownership checks when a Checkout session is confirmed.

The adapter rejects secret-shaped keys and obvious credential values in Hosting
site configuration. Database responses omit passwords, secret references,
encrypted connection configuration, and complete connection strings. AI setup
instructions use managed binding names instead of secrets.

These client checks are defense in depth only. A modified client can bypass
them, so the hosted backend independently repeats permission, price,
confirmation, ownership, and resource-state validation.

## Prompt Injection Boundary

Uploaded files and external reports are reference material. The AI client and hosted Glitch Agent should not follow instructions found inside uploaded files unless the user repeats that instruction in chat or guidance.

## Reporting Vulnerabilities

Report security issues privately to the Glitch team. Do not open a public issue containing secrets, exploit details, customer data, or token samples.

Include:

- Affected package version.
- Client used: Codex, Cursor, Claude Code, or other.
- Tool name.
- Minimal reproduction.
- Whether a token, title, run, action, or artifact was exposed.

## Token Handling

- Never commit `.env` files.
- Never print `GLITCH_MCP_TOKEN`.
- Never include Authorization headers in logs.
- Store title keys in local secret managers where possible.
- Prefer OAuth when a client supports it.

## Public Repo Threat Model

Assume users can:

- Read all source code.
- Modify the local proxy.
- Bypass client-side checks.
- Replay tool calls with their own scripts.

Therefore, the hosted Glitch MCP service must be the only source of truth for entitlement, scope, title access, and execution decisions.
