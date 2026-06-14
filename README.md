# Glitch MCP

Glitch MCP connects AI developer tools to the hosted Glitch Agent service for game marketing, launch planning, Steam/Twitch analysis, creator outreach, social content, PR, campaign review, and approval workflows.

Glitch MCP makes marketing your game feel like coding. Instead of leaving Codex, Cursor, or Claude Code to open dashboards, rebuild spreadsheets, or translate marketing requests into manual workflows, developers can ask for a concrete marketing task in plain language and get back structured reports, recommended actions, draft assets, upload links, approval steps, and deep links into the full Glitch browser experience. The goal is simple: keep developers focused on building the game while Glitch turns marketing work into reviewable, executable tasks.

More Info Here: https://www.glitch.fun/publishers/agents

## Example Game Marketing Workflows

Use these examples as starting prompts inside your MCP client. Glitch returns structured data your coding agent can read, summarize, compare, and turn into next steps for your game.

### Steam Reports

**Ask:** "Analyze our Steam page for `Neon Drift Arena` and tell me what is hurting wishlists."

**Glitch returns:** a Steam page report with capsule/header image feedback, short-description positioning, tag/category fit, trailer and screenshot notes, review of call-to-action clarity, comparable titles, wishlist conversion risks, and prioritized fixes. This helps you improve the store page before buying traffic or pitching creators, so more interested players convert into wishlists.

**Ask:** "Compare our Steam page against five similar roguelite deckbuilders launching this quarter."

**Glitch returns:** a competitive Steam report with pricing, release timing, tags, capsule messaging, trailer angle, review count, follower/wishlist signals where available, and a positioning map that shows where your game can stand out. This helps you avoid copycat messaging and find a sharper market angle for your launch.

**Ask:** "Create a Steam launch readiness report for our game using our trailer, screenshots, and store copy."

**Glitch returns:** a launch checklist with risk grades, missing assets, copy rewrites, screenshot sequencing suggestions, trailer hook notes, localization considerations, creator/press readiness, and a recommended pre-launch task list. This helps your team know what to fix before a public demo, festival, or launch window.

### Influencer Outreach

**Ask:** "Find creators who would be a good fit for our cozy survival crafting game and draft outreach."

**Glitch returns:** a creator shortlist with channel fit, audience/gameplay match, content style, likely campaign angle, outreach priority, contact notes when available, and personalized draft messages. This helps your game reach creators whose audiences are more likely to care, instead of blasting generic emails.

**Ask:** "Review these YouTube and Twitch creator links and tell me who is worth contacting for our horror demo."

**Glitch returns:** a ranked influencer report with fit score, audience relevance, recent game coverage, risk notes, suggested pitch angle, recommended key, follow-up timing, and approval-ready outreach drafts. This helps you spend limited review-key and outreach time on creators with the best chance of useful coverage.

### PR

**Ask:** "Build a PR plan for announcing our Steam demo next month."

**Glitch returns:** a press plan with announcement angle, target outlet categories, timing, embargo/release-day recommendations, press-kit gaps, subject lines, draft pitch copy, and follow-up tasks. This helps your announcement feel intentional instead of rushed when the demo goes live.

**Ask:** "Turn our latest devlog into a press pitch for indie game journalists."

**Glitch returns:** a PR-ready story angle, journalist-facing pitch, shorter alternate subject lines, quote suggestions, asset checklist, and recommended media targets. This helps translate developer updates into a story press can understand quickly.

### Discord Functionality

**Ask:** "Review our Discord onboarding and suggest changes that help new playtesters know what to do."

**Glitch returns:** a Discord community audit with channel structure notes, onboarding friction, role recommendations, announcement cadence, moderation gaps, playtest call-to-action improvements, and draft welcome/FAQ copy. This helps turn curious players into active testers and community members.

**Ask:** "Create a Discord announcement for our new trailer and prepare follow-up questions for the community."

**Glitch returns:** an announcement draft, short and long variants, suggested image/video attachment guidance, ping recommendations, community questions, poll ideas, and follow-up schedule. This helps your trailer launch create conversation instead of a single post that disappears.

## More Work Glitch Can Manage

- Store page optimization for Steam and other PC storefronts.
- Launch planning, demo planning, festival readiness, and milestone marketing calendars.
- Competitive research, positioning, feature comparison, pricing checks, and market narrative.
- Trailer, screenshot, capsule, key art, and creative review.
- Creator discovery, outreach drafts, campaign tracking, review-key workflows, and follow-ups.
- PR strategy, press-kit review, announcement planning, pitch writing, and outlet targeting.
- Discord community onboarding, announcements, playtest coordination, moderation planning, and engagement prompts.
- Social content calendars, TikTok/Reddit/X/Bluesky post drafts, community updates, and campaign variants.
- Paid marketing review, ad creative feedback, targeting notes, landing-page checks, and campaign QA.
- Player research, feedback synthesis, survey summaries, sentiment themes, and next-step recommendations.
- File-assisted review of screenshots, images, videos, trailers, pitch decks, press kits, CSVs, and documents.
- Approval workflows for risky actions, so developers stay in control before anything is executed.
- Deep links back to the Glitch browser experience when a richer dashboard, report, or approval flow is needed.

This repository is the public adapter. It does not contain the private Glitch Agent planner, prompts, routing policies, queue workers, billing logic, model keys, integration credentials, or executor code. All valuable service logic stays behind the hosted Glitch SaaS boundary.

## What Developers Get

- MCP tools for starting and monitoring Glitch Agent runs.
- Structured reports, pending actions, guidance requests, and artifact links.
- Deep links into the rich Glitch browser experience.
- Optional local stdio proxy for MCP clients that do not yet support remote auth cleanly.
- Client setup docs for Codex, Cursor, and Claude Code.

## What Stays Private

- Core planning prompts.
- Internal route resolution.
- Database queries.
- Billing enforcement.
- Integration secrets.
- Social, ad, creator, and PR execution logic.
- Raw planner traces and private memories.

## Architecture

```text
Codex / Cursor / Claude Code
  -> Glitch MCP adapter
  -> https://api.glitch.fun/api/mcp/v1
  -> Glitch auth, subscription, title, scope, and rate-limit checks
  -> Glitch Agent SaaS backend
  -> Glitch hosted UI for reports, approvals, billing, and integrations
```

## Install

```bash
npm install -g glitch-mcp
```

For local development from this repository:

```bash
npm install
npm run build
npm test
```

## Auth Model

The production API facade lives behind the existing Glitch API domain:

```text
https://api.glitch.fun/api
```

Create a **Title MCP Token** inside the Glitch subscription/security interface and use it as `GLITCH_API_TOKEN` or `GLITCH_MCP_TOKEN`.

```bash
export GLITCH_API_BASE_URL="https://api.glitch.fun/api"
export GLITCH_API_TOKEN="gl_mcp_..."
export GLITCH_TITLE_ID="title_..."
```

Title MCP tokens are still checked server-side for subscription, title access, scopes, rate limits, and action risk. Over the HTTP transport the adapter forwards each caller's own bearer token, so one hosted endpoint serves many developers safely. Hosted **OAuth** is also supported but optional (`GLITCH_MCP_OAUTH_ENABLED`); bearer-token auth works with it off.

More detail: [docs/auth.md](docs/auth.md).

## Codex

Codex stdio proxy:

```toml
[mcp_servers.glitch]
command = "npx"
args = ["-y", "glitch-mcp"]
env_vars = ["GLITCH_API_BASE_URL", "GLITCH_API_TOKEN", "GLITCH_TITLE_ID"]
default_tools_approval_mode = "prompt"
```

Future hosted Streamable HTTP deployments should stay on the same API domain, for example `https://api.glitch.fun/mcp`.

Local development stdio proxy:

```toml
[mcp_servers.glitch]
command = "npx"
args = ["-y", "glitch-mcp"]
env_vars = ["GLITCH_API_BASE_URL", "GLITCH_API_TOKEN", "GLITCH_TITLE_ID"]
default_tools_approval_mode = "prompt"
```

Full guide: [docs/codex.md](docs/codex.md).

## Cursor

Cursor stdio proxy:

```json
{
  "mcpServers": {
    "glitch": {
      "command": "npx",
      "args": ["-y", "glitch-mcp"],
      "env": {
        "GLITCH_API_BASE_URL": "https://api.glitch.fun/api",
        "GLITCH_API_TOKEN": "${GLITCH_API_TOKEN}",
        "GLITCH_TITLE_ID": "${GLITCH_TITLE_ID}"
      }
    }
  }
}
```

Local development stdio proxy:

```json
{
  "mcpServers": {
    "glitch": {
      "command": "npx",
      "args": ["-y", "glitch-mcp"],
      "env": {
        "GLITCH_API_BASE_URL": "https://api.glitch.fun/api",
        "GLITCH_API_TOKEN": "${GLITCH_API_TOKEN}",
        "GLITCH_TITLE_ID": "${GLITCH_TITLE_ID}"
      }
    }
  }
}
```

Full guide: [docs/cursor.md](docs/cursor.md).

## Claude Code

Claude Code stdio proxy:

```bash
export GLITCH_API_BASE_URL="https://api.glitch.fun/api"
export GLITCH_API_TOKEN="gl_mcp_..."
export GLITCH_TITLE_ID="title_..."
claude mcp add glitch -- npx -y glitch-mcp
```

Full guide: [docs/claude-code.md](docs/claude-code.md).

## CLI

```bash
glitch-mcp stdio
glitch-mcp http --host 127.0.0.1 --port 3333
glitch-mcp doctor
glitch-mcp version
```

`stdio` is the default command and is what most local MCP clients launch.

`http` is for local development and enterprise proxy scenarios. The canonical paid facade is still `https://api.glitch.fun/api`.

`doctor` verifies the configured hosted service and token without printing the token.

## Tool Surface

The adapter exposes a deliberately narrow tool surface:

- `glitch_auth_status`
- `glitch_list_titles`
- `glitch_select_title`
- `glitch_get_title_context`
- `glitch_get_billing_status`
- `glitch_start_agent_run`
- `glitch_get_agent_run`
- `glitch_wait_for_agent_run`
- `glitch_list_run_events`
- `glitch_get_final_report`
- `glitch_list_artifacts`
- `glitch_list_pending_actions`
- `glitch_approve_action`
- `glitch_reject_action`
- `glitch_execute_action`
- `glitch_list_guidance`
- `glitch_answer_guidance`
- `glitch_resolve_guidance` — present the agent's stop-gate questions as interactive multiple-choice prompts (MCP elicitation) and route answers back to resume the run
- `glitch_create_upload_url`
- `glitch_upload_file` — upload a local image, video, or document (screenshot, gameplay clip, brief) to a title or run
- `glitch_open_dashboard`

Full contract: [docs/tool-reference.md](docs/tool-reference.md).

Hosted facade contract: [docs/hosted-api-contract.md](docs/hosted-api-contract.md).

## Rich Experience

Glitch MCP uses progressive enhancement:

1. Structured MCP results for every client.
2. Dashboard deep links for the full Glitch browser experience.
3. MCP Apps widgets where a host supports inline interactive UI.

Full UX map: [docs/rich-ui.md](docs/rich-ui.md).

## Safety Defaults

- All paid checks happen on the hosted Glitch service.
- Mutating tools require explicit confirmation.
- Approval and execution are separate.
- Uploaded files are reference material, not trusted instructions.
- `glitch_upload_file` supports images, videos, and documents up to 50 MB; shared HTTP mode rejects local `file_path`s and stdio can be constrained with `GLITCH_MCP_UPLOAD_ALLOWED_ROOTS`.
- Tool errors are sanitized before they reach the AI client.
- Tokens are never printed by `doctor`.
- The public package cannot run the agent without Glitch SaaS.

Security model: [SECURITY.md](SECURITY.md).

## Development

```bash
npm install
npm run build
npm test
```

The tests mock the hosted Glitch facade and cover config loading, HTTP behavior, title selection, run polling, confirmation gates, MCP server initialization, resources, prompts, and tool registration.
