import { JsonObject } from "./glitchClient.js";

/**
 * Human-readable markdown renderers for hosted Glitch payloads.
 *
 * Codex, Cursor, and Claude Code show a tool's text content but rarely render
 * the raw structuredContent. These presenters turn the JSON the facade returns
 * into a compact, dashboard-like summary so the in-client experience is rich
 * even where inline HTML widgets (MCP Apps) are unavailable. Every reader is
 * defensive: unknown or missing fields are skipped, never assumed.
 */

function asRecord(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function truncate(value: string, max = 240): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** Unwrap either a raw run resource or a wait envelope ({ timed_out, run }). */
function unwrapRun(data: JsonObject): { run: JsonObject; timedOut?: boolean } {
  const run = asRecord(data.run);
  if (run) {
    return { run, timedOut: data.timed_out === true };
  }
  return { run: data };
}

function statusLabel(run: JsonObject): string {
  const status = str(run.status) || "unknown";
  if (run.is_terminal === true) {
    return `${status} (finished)`;
  }
  if (run.is_paused === true) {
    return `${status} (waiting on you)`;
  }
  return status;
}

export function presentRun(data: JsonObject): string {
  const { run, timedOut } = unwrapRun(data);
  const lines: string[] = [];

  lines.push(`**Status:** ${statusLabel(run)}`);
  if (timedOut) {
    lines.push("_Still running. Poll again with glitch_wait_for_agent_run or glitch_get_agent_run._");
  }

  const worker = str(run.worker_state_message);
  if (worker) {
    lines.push(`**Worker:** ${worker}`);
  }

  const plan = str(run.plan_summary);
  if (plan) {
    lines.push("", `**Plan:** ${truncate(plan, 400)}`);
  }

  const actions = asArray(run.actions);
  if (actions.length > 0) {
    const byStatus = countBy(actions, (a) => str(asRecord(a)?.status) || "unknown");
    lines.push("", `**Actions (${actions.length}):** ${formatCounts(byStatus)}`);
    const pending = actions.filter((a) => ["needs_approval", "needs_guidance", "proposed"].includes(str(asRecord(a)?.status) || ""));
    for (const action of pending.slice(0, 5)) {
      const record = asRecord(action) || {};
      lines.push(`- ${riskTag(record)} ${str(record.title) || str(record.summary) || str(record.action_type) || "Action"} — _${str(record.status)}_`);
    }
  }

  const guidance = asArray(run.guidance_requests).filter((g) => str(asRecord(g)?.status) === "open");
  if (guidance.length > 0) {
    lines.push("", `**Open guidance (${guidance.length}):**`);
    for (const item of guidance.slice(0, 5)) {
      const record = asRecord(item) || {};
      lines.push(`- ${str(record.question) || "Question"}`);
    }
  }

  const report = asRecord(run.final_report);
  if (report) {
    const summary = str(report.summary);
    if (summary) {
      const partial = run.final_report_is_partial === true ? " _(so far)_" : "";
      lines.push("", `**Report${partial}:** ${truncate(summary, 400)}`);
    }
  }

  return lines.join("\n");
}

export function presentFinalReport(data: JsonObject): string {
  const report = asRecord(data.final_report);
  if (!report) {
    const status = str(data.status);
    return status ? `No report yet. Run status: ${status}.` : "No report is available yet.";
  }

  const lines: string[] = [];
  const partial = data.final_report_is_partial === true ? " (partial — work so far)" : "";

  const headline = str(report.headline);
  if (headline) {
    lines.push(`### ${headline}`);
  }

  const summary = str(report.summary);
  if (summary) {
    lines.push(`**Summary${partial}:** ${summary}`);
  }

  appendList(lines, "Why these results", report.explanation);
  appendList(lines, "Data points", report.data_points);
  appendList(lines, "Next steps", report.next_steps);
  appendList(lines, "Problems or limits", report.problems);

  const links = asArray(report.links);
  if (links.length > 0) {
    lines.push("", "**Links:**");
    for (const link of links.slice(0, 8)) {
      const record = asRecord(link) || {};
      const label = str(record.label) || str(record.name) || str(record.title) || "Open";
      const url = str(record.url) || str(record.href);
      if (url) {
        lines.push(`- [${label}](${url})`);
      }
    }
  }

  const downloads = asArray(report.downloads);
  if (downloads.length > 0) {
    lines.push("", "**Downloads:**");
    for (const download of downloads.slice(0, 8)) {
      const record = asRecord(download) || {};
      const label = str(record.label) || str(record.name) || str(record.original_name) || "Download";
      const url = str(record.url) || str(record.download_url);
      lines.push(url ? `- [${label}](${url})` : `- ${label}`);
    }
  }

  return lines.join("\n");
}

export function presentActions(data: JsonObject): string {
  const items = asArray(data.items);
  if (items.length === 0) {
    return "No matching actions.";
  }

  const lines: string[] = [`**${items.length} action(s):**`, ""];
  for (const item of items.slice(0, 20)) {
    const record = asRecord(item) || {};
    const title = str(record.title) || str(record.summary) || str(record.action_type) || "Action";
    const parts = [`${riskTag(record)} **${title}** — _${str(record.status) || "unknown"}_`];
    const cost = str(record.cost_estimate_usd);
    if (cost && cost !== "0") {
      parts.push(`~$${cost}`);
    }
    if (record.approval_required === true) {
      parts.push("approval required");
    }
    lines.push(`- ${parts.join(" · ")}`);
  }
  return lines.join("\n");
}

export function presentGuidance(data: JsonObject): string {
  const items = asArray(data.items);
  if (items.length === 0) {
    return "No matching guidance requests.";
  }

  const lines: string[] = [`**${items.length} guidance request(s):**`, ""];
  for (const item of items.slice(0, 15)) {
    const record = asRecord(item) || {};
    const severity = str(record.severity);
    lines.push(`- ${severity ? `[${severity}] ` : ""}${str(record.question) || "Question"}`);
    const recommended = str(record.recommended_option);
    if (recommended) {
      lines.push(`  - Recommended: ${recommended}`);
    }
    const options = asArray(record.options)
      .map((option) => str(asRecord(option)?.label) || str(option))
      .filter((value): value is string => Boolean(value));
    if (options.length > 0) {
      lines.push(`  - Options: ${options.join(", ")}`);
    }
  }
  return lines.join("\n");
}

export function presentArtifacts(data: JsonObject): string {
  const items = asArray(data.items);
  if (items.length === 0) {
    return "No artifacts for this run yet.";
  }

  const lines: string[] = [`**${items.length} artifact(s):**`, ""];
  for (const item of items.slice(0, 20)) {
    const record = asRecord(item) || {};
    const name = str(record.original_name) || str(record.kind) || "File";
    const size = sizeLabel(record.size_bytes);
    const url = str(record.download_url) || str(record.preview_url);
    const label = `${name}${size ? ` (${size})` : ""}`;
    lines.push(url ? `- [${label}](${url})` : `- ${label}`);
  }
  return lines.join("\n");
}

export function presentTitles(data: JsonObject): string {
  const items = asArray(data.items);
  if (items.length === 0) {
    return "No titles are visible to this credential.";
  }

  const lines: string[] = [`**${items.length} title(s):**`, ""];
  for (const item of items.slice(0, 25)) {
    const record = asRecord(item) || {};
    const name = str(record.name) || "Untitled";
    const id = str(record.id);
    const pending = str(record.pending_approval_count);
    const guidance = str(record.open_guidance_count);
    const flags = [pending && pending !== "0" ? `${pending} approvals` : null, guidance && guidance !== "0" ? `${guidance} guidance` : null]
      .filter(Boolean)
      .join(", ");
    lines.push(`- **${name}**${id ? ` \`${id}\`` : ""}${flags ? ` — ${flags}` : ""}`);
  }
  return lines.join("\n");
}

export function presentBilling(data: JsonObject): string {
  const hasAccess = data.has_access === true;
  const mcp = asRecord(data.mcp_subscription) || {};
  const plan = asRecord(mcp.plan) || {};
  const priceLabel = str(plan.price_label) || str(data.price_label) || "$10/month per game";
  const lines: string[] = [`**Glitch MCP:** ${hasAccess ? "active" : `not active. Subscribe for ${priceLabel}, or use any paid Glitch plan.`}`];
  if (hasAccess && str(mcp.active_plan_name)) {
    lines.push(`**Plan:** ${str(mcp.active_plan_name)}${mcp.access_source === "business_plan" ? " (business plan)" : ""}`);
  }
  if (hasAccess && typeof mcp.monthly_runs_included === "number") {
    lines.push(
      mcp.monthly_runs_included > 0
        ? `**Agent runs this month:** ${typeof mcp.monthly_runs_used === "number" ? mcp.monthly_runs_used : 0}/${mcp.monthly_runs_included}`
        : `**Agent runs:** not included. Add the ${priceLabel} Glitch MCP plan to run Glitch Agents.`
    );
  }
  if (!hasAccess) {
    lines.push(`**Price:** ${priceLabel}. One plan unlocks every MCP tool for the game, including Glitch Agent runs.`);
  }
  const subscribeUrl = str(mcp.subscribe_url) || str(data.billing_url);
  if (subscribeUrl) {
    lines.push(`**Subscribe or manage:** ${subscribeUrl}`);
  }
  const agents = asArray(data.agents);
  for (const agent of agents.slice(0, 10)) {
    const record = asRecord(agent) || {};
    const name = str(record.name) || "Agent";
    const plan = str(record.billing_plan) || "—";
    const status = str(record.billing_status) || "—";
    const ok = record.has_billing_access === true ? "✓" : "✗";
    lines.push(`- ${ok} ${name} · plan ${plan} · ${status}`);
  }
  return lines.join("\n");
}

export function presentAnalytics(data: JsonObject): string {
  const analytics = asRecord(data.analytics);
  if (analytics) {
    const families = asRecord(analytics.families) || {};
    const reports = asRecord(analytics.reports) || {};
    const identityIncluded = analytics.identity_details_included === true;
    const lines = [
      `**Analytics catalog:** ${Object.keys(reports).length} report(s) across ${Object.keys(families).length} families.`,
      `**Identity detail:** ${identityIncluded ? "included for this credential" : "redacted; requires reports:identity"}.`,
      ""
    ];
    for (const [key, value] of Object.entries(families)) {
      const family = asRecord(value) || {};
      lines.push(`- **${key}** — ${str(family.label) || "Analytics reports"} (${str(family.report_count) || asArray(family.reports).length})`);
    }
    return lines.join("\n");
  }

  const summary = asRecord(data.summary) || {};
  const reports = asArray(data.reports);
  const family = str(data.family);
  const lines = [
    `**${family ? `${family} ` : ""}analytics:** ${str(summary.succeeded) || 0} succeeded, ${str(summary.failed) || 0} unavailable.`,
    ""
  ];
  for (const value of reports.slice(0, 20)) {
    const report = asRecord(value) || {};
    const ok = report.ok === true;
    const empty = report.empty === true ? " · empty" : "";
    const error = str(asRecord(report.error)?.message);
    lines.push(`- ${ok ? "✓" : "✗"} **${str(report.label) || str(report.key) || "Report"}**${empty}${error ? ` — ${truncate(error, 180)}` : ""}`);
  }
  return lines.join("\n");
}

function appendList(lines: string[], heading: string, value: unknown): void {
  const items = asArray(value)
    .map((entry) => str(entry) || str(asRecord(entry)?.text) || str(asRecord(entry)?.label))
    .filter((entry): entry is string => Boolean(entry));
  if (items.length === 0) {
    return;
  }
  lines.push("", `**${heading}:**`);
  for (const item of items.slice(0, 8)) {
    lines.push(`- ${truncate(item, 300)}`);
  }
}

function riskTag(record: JsonObject): string {
  const risk = str(record.risk_level);
  if (!risk || risk === "low") {
    return "·";
  }
  return `[${risk}]`;
}

function countBy<T>(items: T[], key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return counts;
}

function formatCounts(counts: Map<string, number>): string {
  return [...counts.entries()].map(([key, value]) => `${value} ${key}`).join(", ");
}

function sizeLabel(value: unknown): string | undefined {
  const bytes = typeof value === "number" ? value : Number.parseInt(str(value) || "", 10);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return undefined;
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ------------------------------------------------------------------ */
/* Multi-store distribution                                            */
/* ------------------------------------------------------------------ */

/** Overview: one row per store with connection, latest submission and live version. */
export function presentDistributionOverview(data: JsonObject): string {
  const lines: string[] = [];
  const counts = asRecord(data.counts);
  if (counts) {
    lines.push(
      `**Connected stores:** ${str(counts.connected) ?? "0"} · **In flight:** ${str(counts.in_flight) ?? "0"} · **Needs action:** ${str(counts.needs_action) ?? "0"} · **Failed (7d):** ${str(counts.failed_7d) ?? "0"}`
    );
  }

  const rows = asArray(data.platforms).map(asRecord).filter((row): row is JsonObject => row !== undefined);
  if (rows.length) {
    lines.push("", "| Store | Automation | Connection | Latest submission | Live version |", "|---|---|---|---|---|");
    for (const row of rows) {
      const platform = asRecord(row.platform) ?? {};
      const connection = asRecord(row.connection);
      const latest = asRecord(row.latest_submission);
      lines.push(`| ${[
        `${str(platform.name) ?? str(platform.key) ?? "?"} (\`${str(platform.key) ?? "?"}\`)`,
        str(platform.automation) ?? "—",
        connection ? str(connection.status) ?? "unknown" : "not connected",
        latest ? `${str(latest.status) ?? "?"}${latest.dry_run === true ? " (dry run)" : ""} ${str(latest.version_label) ?? ""}`.trim() : "—",
        str(row.last_live_version) ?? "—"
      ].join(" | ")} |`);
    }
  }

  return lines.join("\n");
}

/** Catalog summary: automation level, accepted artifacts and the store's own limits. */
export function presentDistributionPlatforms(platforms: JsonObject[]): string {
  if (!platforms.length) {
    return "_No distribution platforms were returned._";
  }
  const lines: string[] = [];
  for (const platform of platforms) {
    const kinds = asArray(platform.artifact_kinds).map(str).filter(Boolean).join(", ") || "none (tracking only)";
    const channel = str(platform.default_channel);
    lines.push(`- **${str(platform.name) ?? str(platform.key)}** (\`${str(platform.key)}\`) — ${str(platform.automation) ?? "manual"}; artifacts: ${kinds}${channel ? `; default ${str(platform.channel_label)?.toLowerCase() ?? "channel"}: ${channel}` : ""}`);
    for (const limitation of asArray(platform.limitations).map(str).filter(Boolean).slice(0, 4)) {
      lines.push(`  - ${truncate(limitation as string, 300)}`);
    }
  }
  return lines.join("\n");
}

export function presentDistributionArtifact(artifact: JsonObject): string {
  const lines: string[] = [];
  lines.push(`**Artifact:** \`${str(artifact.id) ?? "?"}\` · ${str(artifact.kind) ?? "?"} · **${str(artifact.status) ?? "unknown"}**`);
  const facts = [
    str(artifact.filename),
    sizeLabel(artifact.size_bytes),
    str(artifact.version_name) ? `version ${str(artifact.version_name)}` : undefined,
    str(artifact.version_code) ? `versionCode ${str(artifact.version_code)}` : undefined,
    str(artifact.package_name)
  ].filter(Boolean);
  if (facts.length) {
    lines.push(facts.join(" · "));
  }
  const invalid = str(artifact.invalid_reason);
  if (invalid) {
    lines.push(`**Invalid:** ${truncate(invalid, 600)}`);
  }
  const issues = asArray(asRecord(artifact.inspection)?.issues).map(asRecord).filter((issue): issue is JsonObject => issue !== undefined);
  if (issues.length) {
    lines.push("", "**Inspection issues:**");
    for (const issue of issues.slice(0, 20)) {
      lines.push(`- ${str(issue.level) ?? "info"} \`${str(issue.code) ?? "issue"}\`: ${truncate(str(issue.message) ?? "", 300)}`);
    }
  }
  return lines.join("\n");
}

/**
 * Submission status, error, preflight and the handoff actions a store needs
 * done outside Glitch (CLI commands, console steps).
 */
export function presentDistributionSubmission(submission: JsonObject): string {
  const lines: string[] = [];
  lines.push(
    `**Submission:** \`${str(submission.id) ?? "?"}\` · ${str(submission.platform) ?? "?"}${str(submission.channel) ? ` (${str(submission.channel)})` : ""} · **${str(submission.status) ?? "unknown"}**${submission.dry_run === true ? " · dry run" : ""}`
  );
  const stage = str(submission.stage);
  if (stage) {
    lines.push(`Stage: ${stage}${str(submission.progress) ? ` (${str(submission.progress)}%)` : ""}`);
  }
  const message = str(asRecord(submission.store_result)?.message);
  if (message) {
    lines.push(truncate(message, 500));
  }

  const error = asRecord(submission.error);
  if (error) {
    lines.push("", `**Error \`${str(error.code) ?? "error"}\`:** ${truncate(str(error.message) ?? "", 500)}`);
    if (str(error.remediation)) {
      lines.push(`Next step: ${truncate(str(error.remediation) as string, 400)}`);
    }
    if (typeof error.retryable === "boolean") {
      lines.push(`Retryable: ${error.retryable ? "yes" : "no"}`);
    }
  }

  const preflight = asArray(submission.preflight).map(asRecord).filter((issue): issue is JsonObject => issue !== undefined);
  if (preflight.length) {
    lines.push("", "**Preflight:**");
    for (const issue of preflight.slice(0, 20)) {
      lines.push(`- ${str(issue.level) ?? "info"} \`${str(issue.code) ?? "issue"}\`: ${truncate(str(issue.message) ?? "", 300)}`);
    }
  }

  const actions = asArray(submission.actions).map(asRecord).filter((action): action is JsonObject => action !== undefined);
  if (actions.length) {
    lines.push("", "**Handoff actions:**");
    for (const action of actions.slice(0, 20)) {
      const kind = str(action.kind);
      if (kind === "report") {
        lines.push("- Report the result with `glitch_report_distribution_result` (the dashboard's curl report command needs a one-time handoff token MCP does not issue).");
        continue;
      }
      lines.push(`- ${truncate(str(action.label) ?? "Step", 300)}${str(action.detail) ? ` — ${truncate(str(action.detail) as string, 300)}` : ""}`);
      const env = asRecord(action.env);
      if (env) {
        lines.push(`  - Environment variables (the developer sets the values; never paste secrets into chat): ${Object.keys(env).map((name) => `\`${name}\``).join(", ")}`);
      }
      if (str(action.command)) {
        lines.push("", "  ```sh", `  ${str(action.command)}`, "  ```");
      }
      if (str(action.url)) {
        lines.push(`  - ${kind === "download" ? "Download" : "Link"}: ${str(action.url)}`);
      }
    }
  }

  const events = asArray(submission.events).map(asRecord).filter((event): event is JsonObject => event !== undefined);
  if (events.length) {
    lines.push("", "**Recent events:**");
    for (const event of events.slice(-10)) {
      lines.push(`- ${str(event.created_at) ?? ""} ${str(event.level) ?? "info"}: ${truncate(str(event.message) ?? "", 240)}`);
    }
  }

  return lines.join("\n");
}

export function presentDistributionSubmissions(rows: JsonObject[]): string {
  if (!rows.length) {
    return "_No distribution submissions match._";
  }
  const lines = ["| Submission | Store | Channel | Version | Status | Created |", "|---|---|---|---|---|---|"];
  for (const row of rows) {
    lines.push(`| \`${str(row.id) ?? "?"}\` | ${str(row.platform) ?? "?"} | ${str(row.channel) ?? "—"} | ${str(row.version_label) ?? "—"} | ${str(row.status) ?? "?"}${row.dry_run === true ? " (dry run)" : ""} | ${str(row.created_at) ?? "—"} |`);
  }
  return lines.join("\n");
}
