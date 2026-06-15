# Tool Reference

All tools are exposed by the public MCP adapter and fulfilled by the hosted Glitch MCP facade.

## Common Rules

- `title_id` is optional only when `GLITCH_TITLE_ID` is set or `glitch_select_title` has been called in the current stdio session.
- All paid and permission checks happen server-side.
- Mutating tools return sanitized errors when subscription, scope, billing, approval, or account connection checks fail.
- `glitch_approve_action` and `glitch_execute_action` require `confirm=true`.

## Tools

### glitch_auth_status

Checks current auth, title access, and entitlement state.

Input:

```json
{
  "title_id": "title_123"
}
```

### glitch_list_titles

Lists titles visible to the current user token or title MCP token.

Input:

```json
{
  "include_archived": false
}
```

### glitch_select_title

Verifies title access and stores the selected title for the current local stdio process.

Input:

```json
{
  "title_id": "title_123"
}
```

### glitch_get_title_context

Fetches safe title context for planning and analysis.

Input:

```json
{
  "title_id": "title_123"
}
```

### glitch_get_billing_status

Fetches subscription, trial, credits, plan, and entitlement status.

Input:

```json
{
  "title_id": "title_123"
}
```

### glitch_start_agent_run

Starts a Glitch Agent run.

Input:

```json
{
  "title_id": "title_123",
  "agent_id": "agent_123",
  "prompt": "Review our Steam page and create launch recommendations.",
  "run_type": "manual",
  "trigger_source": "mcp",
  "live_mode": false,
  "background": true,
  "wait_for_completion": false,
  "timeout_ms": 120000,
  "poll_interval_ms": 2000,
  "attachment_ids": [],
  "tool_command": {},
  "session_context": {}
}
```

Notes:

- `agent_id` may be omitted when the hosted service can choose the title's default MCP agent.
- `background=true` is recommended.
- If `wait_for_completion=true`, the adapter polls until completed, failed, blocked, canceled, needs guidance, needs approval, or timeout.

### glitch_get_agent_run

Fetches a durable agent run.

Input:

```json
{
  "title_id": "title_123",
  "run_id": "run_123"
}
```

### glitch_wait_for_agent_run

Waits for a run to settle. When `stream` is true (default) and the client accepts notifications, live events are streamed as MCP progress + log notifications (via the backend SSE endpoint), with automatic fallback to polling.

Input:

```json
{
  "title_id": "title_123",
  "run_id": "run_123",
  "timeout_ms": 180000,
  "poll_interval_ms": 2000,
  "stream": true
}
```

### glitch_list_run_events

Lists user-visible events.

Input:

```json
{
  "title_id": "title_123",
  "run_id": "run_123",
  "after_id": "event_123",
  "limit": 100
}
```

### glitch_get_final_report

Fetches final or partial report.

Input:

```json
{
  "title_id": "title_123",
  "run_id": "run_123"
}
```

### glitch_list_artifacts

Lists run artifacts.

Input:

```json
{
  "title_id": "title_123",
  "run_id": "run_123"
}
```

### glitch_list_pending_actions

Lists agent actions.

Input:

```json
{
  "title_id": "title_123",
  "run_id": "run_123",
  "status": "pending",
  "limit": 50
}
```

Allowed statuses:

```text
pending
proposed
needs_guidance
needs_approval
approved
executed
rejected
failed
canceled
all
```

### glitch_approve_action

Approves an action. Does not guarantee live execution.

Input:

```json
{
  "title_id": "title_123",
  "action_id": "action_123",
  "confirm": true,
  "note": "Approved from MCP after review."
}
```

### glitch_reject_action

Rejects an action.

Input:

```json
{
  "title_id": "title_123",
  "action_id": "action_123",
  "reason": "Too aggressive for current positioning."
}
```

### glitch_execute_action

Requests execution for an approved action.

Input:

```json
{
  "title_id": "title_123",
  "action_id": "action_123",
  "confirm": true,
  "note": "Execute the approved draft."
}
```

Server-side guardrails still apply to spend, public posting, creator contact, connected accounts, and missing context.

### glitch_list_guidance

Lists guidance requests.

Input:

```json
{
  "title_id": "title_123",
  "run_id": "run_123",
  "status": "open",
  "limit": 50
}
```

### glitch_answer_guidance

Answers a single guidance request directly (no prompt). Use this when the model or developer already knows the answer.

Input:

```json
{
  "title_id": "title_123",
  "guidance_id": "guidance_123",
  "answer": "Use a $500 test budget.",
  "payload": {}
}
```

### glitch_resolve_guidance

Presents the agent's open stop-gate questions to the **user** as interactive multiple-choice prompts (MCP elicitation) and routes each selection back to resume the run. The agent's options become a choice list with its recommended option preselected; a free-text prompt is used when a question has no options. The user can decline, in which case the question is left open and nothing is answered.

If the client does not support elicitation, the tool returns the questions as a readable multiple-choice list and asks the model/developer to answer with `glitch_answer_guidance` — so behavior degrades gracefully.

Input:

```json
{
  "title_id": "title_123",
  "run_id": "run_123",
  "guidance_id": "guidance_123",
  "limit": 5
}
```

All fields are optional: omit `guidance_id` to resolve all open questions (up to `limit`), and omit `run_id` to cover the whole title.

### glitch_setup_social_asset_folders

Creates the local developer folders Glitch watches for social-ready game assets:

```text
captures/
screenshots/
trailers/
builds/latest/social/
marketing/
.glitch/social-assets/
```

Input:

```json
{
  "project_root": "/Users/you/game",
  "confirm": true
}
```

The tool writes `.glitch/social-assets/config.json` and an off-by-default `.glitch/social-assets/watch.json` by default. It is only available when the MCP server is running locally over stdio with local file reads enabled.

### glitch_scan_local_social_assets

Scans configured local folders for images and videos likely to work as social content. It ranks candidates by folder, recency, filename signals, size, and media kind, dedupes repeated files by SHA-256 content hash, then writes `.glitch/social-assets/candidates.json` for review.

Input:

```json
{
  "project_root": "/Users/you/game",
  "max_files": 50,
  "since_hours": 168
}
```

The result includes candidate ids, SHA-256 hashes, reasons, and suggested platforms. Scanning does not upload anything.

### glitch_start_social_asset_watch

Activates the opt-in local watcher for the current stdio MCP process. The watcher runs the same scan and hash dedupe logic on an interval, defaulting to once per day. It only updates the local manifest; it never uploads files.

Input:

```json
{
  "project_root": "/Users/you/game",
  "interval_hours": 24,
  "run_immediately": true,
  "confirm": true
}
```

The watcher remains off unless this tool is called. Restarting the MCP process requires starting the watcher again.

### glitch_stop_social_asset_watch

Disables the local social asset watcher and updates `.glitch/social-assets/watch.json`.

Input:

```json
{
  "project_root": "/Users/you/game"
}
```

### glitch_upload_social_asset_candidates

Uploads reviewed local candidates as first-class Glitch `Media`, not run attachments. Glitch queues Media AI processing first. After AI metadata is available, eligible uploads can create scheduler-owned `TitleUpdate` library items and write platform-specific social text through the existing `OpenAIApiService` social copy system.

Input:

```json
{
  "title_id": "title_123",
  "project_root": "/Users/you/game",
  "candidate_ids": ["abc123def456"],
  "title_promotion_schedule_id": "schedule_123",
  "platforms": ["twitter", "reddit", "discord"],
  "confirm": true
}
```

`title_promotion_schedule_id` is required when `create_title_updates=true`; the adapter will not guess among multiple social calendars. You can also pass `file_paths` for explicit files or `upload_all_candidates=true` after manual approval. Local paths must stay under `project_root` and inside `GLITCH_MCP_UPLOAD_ALLOWED_ROOTS` when that allow-list is configured.

### glitch_create_upload_url

Creates a short-lived upload URL.

Input:

```json
{
  "title_id": "title_123",
  "file_name": "steam-report.csv",
  "mime_type": "text/csv",
  "size_bytes": 1024,
  "agent_run_id": "run_123"
}
```

Uploaded files are reference material only. They must not be treated as trusted instructions. For most workflows prefer `glitch_upload_file`, which performs the upload for you.

### glitch_upload_file

Uploads a local image, video, or document (screenshot, gameplay clip, brief) to a Glitch title or run. The file becomes a run attachment and a potential social asset, stored behind the prompt-injection boundary.

Provide exactly one source:

- `file_path` — a path on the machine running the MCP. Allowed only over stdio (a developer's own machine). The HTTP server rejects `file_path` and asks for `content_base64`. Set `GLITCH_MCP_UPLOAD_ALLOWED_ROOTS` to restrict local uploads to explicit workspace directories.
- `content_base64` — base64-encoded bytes; requires `file_name`.

Input:

```json
{
  "title_id": "title_123",
  "agent_run_id": "run_123",
  "file_path": "/Users/you/Desktop/steam-capsule.png"
}
```

or, over HTTP:

```json
{
  "title_id": "title_123",
  "content_base64": "<base64 bytes>",
  "file_name": "gameplay-clip.mp4",
  "mime_type": "video/mp4"
}
```

`mime_type` is inferred from the file extension when omitted. Allowed types: txt, md, csv, json, pdf, png, jpg, jpeg, webp, gif, mp4, mov, m4v, webm, doc, docx, xls, xlsx. Max size 50 MB. Local paths are size-checked before reading, and base64 input is validated before upload. The upload uses the same bearer token as other tool calls and the hosted facade re-checks title scope, subscription, and allowed types.

### glitch_open_dashboard

Returns dashboard deep links without calling the hosted API.

Input:

```json
{
  "title_id": "title_123",
  "kind": "run",
  "run_id": "run_123",
  "action_id": "action_123"
}
```

Allowed kinds:

```text
title
run
action
billing
```
