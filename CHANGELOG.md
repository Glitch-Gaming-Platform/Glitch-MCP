# Changelog

## Unreleased

- Added Cursor and Claude Code slash-command installers: `glitch-mcp install-cursor-prompts` copies Glitch prompts to `.cursor/commands`, and `glitch-mcp install-claude-prompts` copies them to `.claude/commands`.
- Added bundled Codex slash-command prompts for every public Glitch MCP tool plus higher-level workflows. Developers can install them with `glitch-mcp install-codex-prompts` and invoke them as `/prompts:glitch...` in Codex.
- Registered direct command-style MCP prompts for the public tool surface, so MCP clients with prompt discovery can route prompt commands to exact Glitch MCP tool names.
- Added README and Codex docs guidance, including a screenshot of the Codex prompt menu.
- Added `glitch_resolve_guidance`: the agent's stop-gate questions are now presented to the user as **interactive multiple-choice prompts via MCP elicitation** (enum + recommended option preselected) in clients that support it (e.g. Claude Code), and each answer is routed back to resume the run. Capability-gated with a readable fallback list, so `glitch_list_guidance` and `glitch_answer_guidance` keep working unchanged in clients without elicitation.
- Rich, readable tool results: run status, final report, actions, guidance, artifacts, titles, and billing now render as a compact markdown summary in the tool's text content, so Codex/Cursor/Claude Code show a dashboard-like result instead of a generic "structured data included" line. Inline HTML widgets remain a progressive enhancement for hosts that support MCP Apps.
- Optional **live streaming** for long runs: `glitch_wait_for_agent_run` streams events as MCP progress + log notifications (new `stream` arg, default on) via a new backend SSE endpoint (`GET /mcp/v1/titles/{title}/runs/{run}/stream`), with transparent fallback to polling.
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
