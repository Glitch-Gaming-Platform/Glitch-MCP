import { describe, expect, it } from "vitest";
import {
  presentActions,
  presentArtifacts,
  presentBilling,
  presentFinalReport,
  presentGuidance,
  presentRun,
  presentTitles
} from "../src/present.js";

describe("presenters", () => {
  it("renders a run with status, pending actions, guidance, and report summary", () => {
    const md = presentRun({
      run: {
        status: "needs_approval",
        is_paused: true,
        plan_summary: "Audit the Steam page and draft launch posts.",
        actions: [
          { status: "needs_approval", risk_level: "medium", title: "Draft TikTok post" },
          { status: "executed", title: "Analyze Steam page" }
        ],
        guidance_requests: [{ status: "open", question: "Which launch date should we target?" }],
        final_report: { summary: "Three launch tasks drafted." },
        final_report_is_partial: true
      },
      timed_out: false
    });

    expect(md).toContain("waiting on you");
    expect(md).toContain("Draft TikTok post");
    expect(md).toContain("[medium]");
    expect(md).toContain("Which launch date");
    expect(md).toContain("Report _(so far)_");
  });

  it("flags a timed-out wait envelope", () => {
    const md = presentRun({ timed_out: true, run: { status: "running" } });
    expect(md).toContain("Still running");
  });

  it("renders a final report with sections and links", () => {
    const md = presentFinalReport({
      status: "completed",
      final_report: {
        headline: "Launch readiness",
        summary: "You are 80% ready.",
        explanation: ["Steam page is strong"],
        next_steps: ["Schedule the trailer"],
        problems: [],
        links: [{ label: "Steam page", url: "https://store.steampowered.com/app/1" }],
        downloads: [{ name: "report.csv", download_url: "https://app.glitch.fun/d/1" }]
      }
    });
    expect(md).toContain("### Launch readiness");
    expect(md).toContain("80% ready");
    expect(md).toContain("Next steps");
    expect(md).toContain("[Steam page](https://store.steampowered.com/app/1)");
    expect(md).toContain("[report.csv](https://app.glitch.fun/d/1)");
  });

  it("handles a missing report gracefully", () => {
    expect(presentFinalReport({ status: "running" })).toContain("No report yet");
  });

  it("renders actions, guidance, artifacts, titles, and billing", () => {
    expect(presentActions({ items: [{ title: "Post", status: "needs_approval", risk_level: "high", cost_estimate_usd: "12", approval_required: true }] }))
      .toContain("approval required");
    expect(presentGuidance({ items: [{ question: "Pick a date", recommended_option: "June", options: [{ label: "June" }, { label: "July" }] }] }))
      .toContain("Recommended: June");
    expect(presentArtifacts({ items: [{ original_name: "chart.png", size_bytes: 2048, download_url: "https://x/y" }] }))
      .toContain("[chart.png (2 KB)](https://x/y)");
    expect(presentTitles({ items: [{ name: "My Game", id: "title_1", pending_approval_count: "2" }] }))
      .toContain("My Game");
    expect(presentBilling({ has_access: true, agents: [{ name: "Marketer", billing_plan: "pro", billing_status: "active", has_billing_access: true }] }))
      .toContain("active");
  });

  it("renders empty states without throwing", () => {
    expect(presentActions({ items: [] })).toContain("No matching actions");
    expect(presentTitles({})).toContain("No titles");
    expect(presentArtifacts({ items: [] })).toContain("No artifacts");
  });
});
