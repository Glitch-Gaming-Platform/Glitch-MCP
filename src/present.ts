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
  const lines: string[] = [`**Access:** ${hasAccess ? "active" : "no active subscription/credits"}`];
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
