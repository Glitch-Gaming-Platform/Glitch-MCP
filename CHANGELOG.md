# Changelog

## Unreleased

- Added the `glitch_upload_file` tool: upload a local image, video, or document (screenshot, gameplay clip, brief) from Cursor/Codex/Claude Code to a Glitch title or run. Reads `file_path` over stdio or `content_base64` over HTTP, infers the mime type, and uploads multipart to a new MCP-token-usable backend endpoint (`POST /mcp/v1/titles/{title}/files`). Local file-path reads are gated by transport (on for stdio, off for the shared HTTP server).
- Made hosted **OAuth optional** (`GLITCH_MCP_OAUTH_ENABLED`, default off). When enabled, the HTTP server serves OAuth 2.0 Protected Resource Metadata (RFC 9728) at `/.well-known/oauth-protected-resource` and challenges unauthenticated requests with `WWW-Authenticate`; token verification stays with Glitch. Plain bearer-token auth keeps working when OAuth is off.
- Added DNS-rebinding `allowedHosts` (`GLITCH_MCP_ALLOWED_HOSTS`) for non-localhost binding and an optional in-memory edge rate limiter (`GLITCH_MCP_RATE_LIMIT_PER_MINUTE`, default off) keyed per credential.
- Streamable HTTP mode now forwards each request's `Authorization` bearer to the hosted Glitch service, so a multi-tenant deployment authenticates as the caller instead of a single shared operator token. stdio mode still falls back to the configured token.
- `glitch_wait_for_agent_run` now stops promptly when a run is stopped or paused for user input. It prefers the backend `is_settled` flag and aligns its fallback status list (now including `stopped`, `waiting`, `paused`) with the hosted facade's terminal/paused taxonomy.
- Exposed `is_terminal`, `is_paused`, and `is_settled` on the agent run payload (`AgentRunResource`) as the authoritative, drift-proof source of run lifecycle state.
- Added `express` as an explicit dependency so the `glitch-mcp http` subcommand no longer relies on a transitive install.
- Added a version-sync guard test (`GLITCH_MCP_VERSION` must match `package.json`) plus tests for per-request auth forwarding and settled-run detection.

## 0.1.0

- Initial public Glitch MCP adapter.
- Added stdio MCP server for local client integrations.
- Added local Streamable HTTP mode for development and enterprise proxy scenarios.
- Added hosted Glitch API client with sanitized error mapping.
- Added title selection, run lifecycle, reports, artifacts, guidance, approvals, execution, upload URL, billing, and dashboard link tools.
- Added prompts and resources for MCP-native clients.
- Added docs for Codex, Cursor, Claude Code, auth, rich UI, tools, security, and edge cases.
- Added tests for config, HTTP behavior, title selection, run polling, tool gates, and MCP initialization.
