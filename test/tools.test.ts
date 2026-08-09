import { describe, expect, it, vi } from "vitest";
import { GlitchClient } from "../src/glitchClient.js";
import { safeTool } from "../src/result.js";
import { glitchToolDefinitions, type ToolRuntimeContext } from "../src/tools.js";
import { createFetchMock, jsonResponse } from "./helpers.js";

const config = {
  apiBaseUrl: "https://mcp.example.test",
  dashboardBaseUrl: "https://app.example.test",
  timeoutMs: 1000,
  clientName: "test-client",
  defaultTitleId: "title_default"
};

describe("Glitch MCP tools", () => {
  it("exposes the expected public tool surface", () => {
    expect(glitchToolDefinitions.map((tool) => tool.name)).toEqual([
      "glitch_auth_status",
      "glitch_list_titles",
      "glitch_select_title",
      "glitch_get_title_context",
      "glitch_list_game_development_prompts",
      "glitch_get_game_development_prompt",
      "glitch_list_game_genres",
      "glitch_generate_game_design_blueprint",
      "glitch_get_analytics_capabilities",
      "glitch_get_analytics_report",
      "glitch_get_session_reports",
      "glitch_get_web_reports",
      "glitch_get_storefront_reports",
      "glitch_get_wishlist_reports",
      "glitch_get_earnings_reports",
      "glitch_get_attribution_reports",
      "glitch_get_cross_device_reports",
      "glitch_get_billing_status",
      "glitch_get_social_capabilities",
      "glitch_social_operation",
      "glitch_start_agent_run",
      "glitch_get_agent_run",
      "glitch_wait_for_agent_run",
      "glitch_list_run_events",
      "glitch_get_final_report",
      "glitch_list_artifacts",
      "glitch_list_pending_actions",
      "glitch_approve_action",
      "glitch_reject_action",
      "glitch_execute_action",
      "glitch_list_guidance",
      "glitch_answer_guidance",
      "glitch_resolve_guidance",
      "glitch_setup_social_asset_folders",
      "glitch_scan_local_social_assets",
      "glitch_start_social_asset_watch",
      "glitch_stop_social_asset_watch",
      "glitch_upload_social_asset_candidates",
      "glitch_create_upload_url",
      "glitch_upload_file",
      "glitch_open_dashboard",
      "glitch_get_hosting",
      "glitch_get_hosting_analytics",
      "glitch_create_hosting_site",
      "glitch_update_hosting_site",
      "glitch_list_hosting_releases",
      "glitch_deploy_hosting_build",
      "glitch_promote_hosting_release",
      "glitch_connect_hosting_domain",
      "glitch_verify_hosting_domain",
      "glitch_check_hosting_domain",
      "glitch_purchase_hosting_domain",
      "glitch_generate_hosting_ai_instructions",
      "glitch_list_hosting_services",
      "glitch_estimate_hosting_services",
      "glitch_apply_hosting_services",
      "glitch_list_hosting_databases",
      "glitch_get_hosting_database",
      "glitch_create_hosting_database",
      "glitch_update_hosting_database",
      "glitch_retry_hosting_database",
      "glitch_delete_hosting_database",
      "glitch_change_hosting_plan",
      "glitch_confirm_hosting_checkout",
      "glitch_list_multiplayer_lobbies",
      "glitch_create_multiplayer_lobby",
      "glitch_browse_multiplayer_servers",
      "glitch_list_multiplayer_realms",
      "glitch_create_install",
      "glitch_validate_install",
      "glitch_list_cloud_saves",
      "glitch_store_cloud_save",
      "glitch_resolve_cloud_save_conflict",
      "glitch_submit_progression",
      "glitch_list_leaderboards",
      "glitch_read_leaderboard",
      "glitch_list_achievement_definitions",
      "glitch_list_player_achievements",
      "glitch_list_deployments",
      "glitch_update_deployment_status",
      "glitch_deploy_game_build"
    ]);
  });

  it("lists and retrieves complete public game-development prompts", async () => {
    const client = new GlitchClient(config, createFetchMock(() => jsonResponse({ data: {} })).fetch);
    const listed = await callTool("glitch_list_game_development_prompts", client, {
      category: "foundation",
      search: "automation"
    });

    expect(listed.structuredContent?.data).toMatchObject({
      count: 1,
      prompts: [
        expect.objectContaining({
          id: "remote-game-automation",
          resource_uri: "glitch://game-development/prompts/remote-game-automation"
        })
      ]
    });

    const retrieved = await callTool("glitch_get_game_development_prompt", client, {
      prompt_id: "visual-quality-rubric"
    });
    expect(retrieved.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Before rating my current game, ask me to upload representative artwork and gameplay")
    });
    expect(retrieved.content[0]).toMatchObject({
      text: expect.stringContaining("## Required game documentation")
    });
    expect(retrieved.structuredContent?.data).toMatchObject({
      id: "visual-quality-rubric",
      url: "https://www.glitch.fun/publishers/tools/ai-game-development-prompts?prompt=visual-quality-rubric#prompt-picker"
    });
  });

  it("fetches live genres and generates a multi-genre blueprint with progress", async () => {
    const mock = createFetchMock((request) => {
      if (request.url.endsWith("/util/genres")) {
        return jsonResponse({ data: [{ id: 1, name: "Cozy" }, { id: 2, name: "Puzzle" }] });
      }
      return jsonResponse({
        data: {
          gameName: "Signal Garden",
          descriptor: "A cooperative cozy puzzle game about rebuilding living radio gardens.",
          coreFantasy: "Feel like signal gardeners reconnecting isolated communities.",
          coreVerbs: ["Listen", "Tune", "Plant", "Connect"],
          pillars: [{ title: "Readable signals", description: "Every signal has a clear need." }],
          mechanics: [{ title: "Signal tuning", description: "Tuning changes nearby plants." }],
          coreLoop: [{ title: "Listen", description: "Read the current signal." }],
          sessionLoop: ["Prepare", "Tune", "Restore"],
          coreTest: "Is tuning a changing signal fun?",
          scopeRules: ["Test one garden first."],
          documentationInstruction: "Save or update docs/game-design/mechanics-and-core-loop.md.",
          ai_used: true
        }
      });
    });
    const client = new GlitchClient(config, mock.fetch);

    const genres = await callTool("glitch_list_game_genres", client, {});
    expect(mock.requests[0]?.url).toBe("https://mcp.example.test/util/genres");
    expect(genres.structuredContent?.data).toEqual({ genres: [{ id: 1, name: "Cozy" }, { id: 2, name: "Puzzle" }] });

    const progress = vi.fn(async () => {});
    const log = vi.fn(async () => {});
    const context: ToolRuntimeContext = {
      streamingEnabled: true,
      canElicit: false,
      progress,
      log,
      async elicit() {
        return { action: "unsupported" };
      }
    };
    const result = await callTool("glitch_generate_game_design_blueprint", client, {
      game_name: "Signal Garden",
      genres: ["Cozy", "Puzzle"],
      play_mode: "cooperative",
      session_length: "15–30 minute",
      player_fantasy: "two signal gardeners reconnecting isolated communities",
      setting: "floating islands where radio signals grow as plants",
      primary_goal: "restore the shared broadcast before the seasonal storm",
      main_pressure: "signals decay while each island asks for different help",
      signature_twist: "tuning one signal changes every nearby plant",
      progression: "unlock new instruments and signal seeds",
      preferred_activities: "listen, tune, plant, connect"
    }, context);

    expect(mock.requests[1]?.url).toBe("https://mcp.example.test/tools/game-design/blueprint");
    expect(mock.requests[1]?.body).toMatchObject({
      gameName: "Signal Garden",
      genre: "cozy",
      genres: ["Cozy", "Puzzle"],
      playMode: "cooperative",
      sessionLength: "15–30 minute"
    });
    expect(progress).toHaveBeenNthCalledWith(1, 1, 2, "Generating mechanics and core loop…");
    expect(progress).toHaveBeenNthCalledWith(2, 2, 2, "Game-design blueprint ready");
    expect(log).toHaveBeenCalledTimes(2);
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining("## Documentation update") });
  });

  it("generates the documentation-ready local blueprint when the hosted AI route is unavailable", async () => {
    const mock = createFetchMock(() => jsonResponse({ message: "Not found" }, 404));
    const client = new GlitchClient(config, mock.fetch);

    const result = await callTool("glitch_generate_game_design_blueprint", client, {
      genres: ["Action", "Puzzle"],
      play_mode: "single-player",
      session_length: "5–10 minute",
      player_fantasy: "an inventor repairing a living clockwork garden",
      setting: "a city-sized mechanical greenhouse",
      primary_goal: "restart the central seasonal engine",
      main_pressure: "every repaired district destabilizes another one",
      signature_twist: "changing time in one room changes nearby ecosystems"
    });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent?.summary).toContain("deterministic fallback");
    expect(result.structuredContent?.data).toMatchObject({
      ai_used: false,
      documentationInstruction: expect.stringContaining("docs/game-design/mechanics-and-core-loop.md")
    });
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining("## Moment-to-moment core loop") });
  });

  it("starts a run using the default title and maps prompt to hosted API initial_message", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: { id: "run_1", status: "queued" } }));
    const client = new GlitchClient(config, mock.fetch);
    const result = await callTool("glitch_start_agent_run", client, { prompt: "Build a launch plan" });

    expect(result.isError).toBeUndefined();
    expect(mock.requests[0]?.url).toBe("https://mcp.example.test/mcp/v1/titles/title_default/runs");
    expect(mock.requests[0]?.body).toMatchObject({
      initial_message: "Build a launch plan",
      run_type: "manual",
      trigger_source: "mcp",
      background: true
    });
    expect(result.structuredContent?.data).toEqual({ id: "run_1", status: "queued" });
  });

  it("returns the title-scoped billing page as a visible link when a run is payment blocked", async () => {
    const billingUrl = "https://app.example.test/agents/titles/title_default/billing";
    const dashboardUrl = "https://app.example.test/agents/titles/title_default";
    const mock = createFetchMock(() => jsonResponse({
      data: { id: "run_blocked", status: "blocked", error: "subscription_required" },
      message: "A Glitch Agent subscription is required before this run can execute.",
      billing_url: billingUrl,
      dashboard_url: dashboardUrl
    }, 402));
    const client = new GlitchClient(config, mock.fetch);
    const result = await safeTool(() => callTool("glitch_start_agent_run", client, { prompt: "Post the approved image to X" }));

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(`Open agent billing: ${billingUrl}`);
    expect(result.content).toContainEqual(expect.objectContaining({
      type: "resource_link",
      uri: billingUrl,
      name: "Open agent billing"
    }));
    expect(result.structuredContent).toMatchObject({
      status: "error",
      code: "subscription_required",
      details: { billingUrl, dashboardUrl },
      links: [
        { name: "Open agent billing", url: billingUrl },
        { name: "Open Glitch dashboard", url: dashboardUrl }
      ]
    });
  });

  it("retrieves the authoritative social capability catalog", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: { operation_count: 108, platforms: {} } }));
    const client = new GlitchClient(config, mock.fetch);
    const result = await callTool("glitch_get_social_capabilities", client, {});

    expect(result.isError).toBeUndefined();
    expect(mock.requests[0]?.url).toBe("https://mcp.example.test/mcp/v1/titles/title_default/social/capabilities");
    expect(result.structuredContent?.data).toEqual({ operation_count: 108, platforms: {} });
  });

  it("retrieves the authoritative analytics capability catalog", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: { analytics: { families: {}, reports: {} } } }));
    const client = new GlitchClient(config, mock.fetch);
    const result = await callTool("glitch_get_analytics_capabilities", client, {});

    expect(result.isError).toBeUndefined();
    expect(mock.requests[0]?.url).toBe("https://mcp.example.test/mcp/v1/titles/title_default/analytics/capabilities");
    expect(result.structuredContent?.data).toEqual({ analytics: { families: {}, reports: {} } });
  });

  it("runs one canonical analytics report with typed filters", async () => {
    const mock = createFetchMock(() =>
      jsonResponse({ data: { summary: { succeeded: 1, failed: 0 }, reports: [{ key: "retention.d7", ok: true }] } })
    );
    const client = new GlitchClient(config, mock.fetch);
    const result = await callTool("glitch_get_analytics_report", client, {
      report_key: "retention.d7",
      filters: { start_date: "2026-07-01", end_date: "2026-08-01", platform: ["steam", "pc"] }
    });

    expect(result.isError).toBeUndefined();
    expect(mock.requests[0]?.url).toBe("https://mcp.example.test/mcp/v1/titles/title_default/analytics/query");
    expect(mock.requests[0]?.body).toEqual({
      reports: [
        {
          key: "retention.d7",
          filters: { start_date: "2026-07-01", end_date: "2026-08-01", platform: ["steam", "pc"] }
        }
      ],
      fail_fast: false
    });
  });

  it("runs a family analytics bundle with common and per-report filters", async () => {
    const mock = createFetchMock(() =>
      jsonResponse({ data: { family: "sessions", summary: { succeeded: 2, failed: 0 }, reports: [] } })
    );
    const client = new GlitchClient(config, mock.fetch);
    const result = await callTool("glitch_get_session_reports", client, {
      report_keys: ["sessions.average", "behavioral_funnels.report"],
      filters: { start_date: "2026-07-01", end_date: "2026-08-01" },
      report_filters: { "behavioral_funnels.report": { funnel_id: "auto-observed-journey" } }
    });

    expect(result.isError).toBeUndefined();
    expect(mock.requests[0]?.body).toEqual({
      family: "sessions",
      report_keys: ["sessions.average", "behavioral_funnels.report"],
      filters: { start_date: "2026-07-01", end_date: "2026-08-01" },
      report_filters: { "behavioral_funnels.report": { funnel_id: "auto-observed-journey" } },
      fail_fast: false
    });
  });

  it("runs a social operation with arguments and explicit confirmation", async () => {
    const mock = createFetchMock(() =>
      jsonResponse({ data: { operation: "posts.reschedule", result: { id: "post_1", status: "scheduled" } } })
    );
    const client = new GlitchClient(config, mock.fetch);
    const result = await callTool("glitch_social_operation", client, {
      operation: "posts.reschedule",
      arguments: { post_id: "post_1", scheduled_at: "2026-08-03T15:00:00Z" },
      confirm: true
    });

    expect(result.isError).toBeUndefined();
    expect(mock.requests[0]?.url).toBe(
      "https://mcp.example.test/mcp/v1/titles/title_default/social/operations/posts.reschedule"
    );
    expect(mock.requests[0]?.body).toEqual({
      arguments: { post_id: "post_1", scheduled_at: "2026-08-03T15:00:00Z" },
      confirm: true
    });
  });

  it("can wait for a started run when requested", async () => {
    vi.useFakeTimers();
    const mock = createFetchMock((_request, index) => {
      if (index === 0) {
        return jsonResponse({ data: { id: "run_1", status: "queued" } });
      }
      return jsonResponse({ data: { id: "run_1", status: "completed" } });
    });
    const client = new GlitchClient(config, mock.fetch);

    const promise = callTool("glitch_start_agent_run", client, {
      prompt: "Build a launch plan",
      wait_for_completion: true,
      poll_interval_ms: 1,
      timeout_ms: 1000
    });
    await vi.advanceTimersByTimeAsync(1);
    const result = await promise;

    expect(result.structuredContent?.data).toEqual({
      timed_out: false,
      run: { id: "run_1", status: "completed" }
    });
    vi.useRealTimers();
  });

  it("blocks approval unless confirm=true is supplied", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: { id: "action_1" } }));
    const client = new GlitchClient(config, mock.fetch);
    const result = await safeTool(() => callTool("glitch_approve_action", client, { action_id: "action_1" }));

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      status: "error",
      code: "confirmation_required"
    });
    expect(mock.requests).toHaveLength(0);
  });

  it("approves an action when confirm=true is supplied", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: { id: "action_1", status: "approved" } }));
    const client = new GlitchClient(config, mock.fetch);
    const result = await callTool("glitch_approve_action", client, {
      action_id: "action_1",
      confirm: true,
      note: "Looks good."
    });

    expect(result.isError).toBeUndefined();
    expect(mock.requests[0]?.url).toBe("https://mcp.example.test/mcp/v1/titles/title_default/actions/action_1/approve");
    expect(mock.requests[0]?.body).toEqual({ note: "Looks good.", source: "mcp" });
  });

  it("returns dashboard links without calling the hosted API", async () => {
    const mock = createFetchMock(() => {
      throw new Error("No network expected.");
    });
    const client = new GlitchClient(config, mock.fetch);
    const result = await callTool("glitch_open_dashboard", client, {
      kind: "run",
      run_id: "run_1"
    });

    expect(mock.requests).toHaveLength(0);
    expect(result.structuredContent?.data).toEqual({
      title_id: "title_default",
      url: "https://app.example.test/agents/titles/title_default?run=run_1"
    });
  });

  it("deploys a ready game build to the only hosting site and publishes it", async () => {
    const mock = createFetchMock((request) => {
      if (request.url.includes("/deployments?")) {
        return jsonResponse({ data: [{ id: "build_1", status: "ready", deployment_type: "wasm" }] });
      }
      if (request.url.endsWith("/hosting")) {
        return jsonResponse({ data: { sites: [{ id: "site_1", generated_hostname: "neon.pixel.glitch.fun" }] } });
      }
      if (request.url.endsWith("/hosting/sites/site_1/releases") && request.init?.method === "POST") {
        return jsonResponse({ data: { id: "release_1", status: "processing" } }, 202);
      }
      if (request.url.includes("/hosting/sites/site_1/releases?") && request.init?.method === "GET") {
        return jsonResponse({ data: [{ id: "release_1", status: "ready" }] });
      }
      if (request.url.endsWith("/hosting/sites/site_1/releases/release_1/promote")) {
        return jsonResponse({ data: { id: "site_1", status: "live", url: "https://neon.pixel.glitch.fun" } });
      }
      return jsonResponse({ message: "Unexpected request" }, 500);
    });
    const client = new GlitchClient(config, mock.fetch);
    const result = await callTool("glitch_deploy_hosting_build", client, {
      game_build_id: "build_1",
      version: "1.0.0",
      confirm: true,
      poll_interval_ms: 1,
      timeout_ms: 1000
    });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent?.data).toMatchObject({
      site: { id: "site_1", status: "live" },
      release: { id: "release_1", status: "ready" }
    });
    expect(mock.requests.some((request) => request.url.endsWith("/hosting/sites/site_1/releases/release_1/promote"))).toBe(true);
  });

  it("does not create a hosting release without explicit confirmation", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: {} }));
    const client = new GlitchClient(config, mock.fetch);
    const result = await safeTool(() => callTool("glitch_deploy_hosting_build", client, {
      game_build_id: "build_1",
      version: "1.0.0"
    }));

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ status: "error", code: "confirmation_required" });
    expect(mock.requests).toHaveLength(0);
  });

  it("estimates a large realtime service stack without confirmation", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: { estimated_monthly_floor_cents: 50225 } }));
    const client = new GlitchClient(config, mock.fetch);
    const result = await callTool("glitch_estimate_hosting_services", client, {
      site_id: "site_1",
      preset: "large_realtime_world",
      game_build_id: "build_1"
    });

    expect(result.isError).toBeUndefined();
    expect(mock.requests[0]?.url).toBe("https://mcp.example.test/mcp/v1/titles/title_default/hosting/sites/site_1/services/estimate");
    expect(mock.requests[0]?.body).toMatchObject({ preset: "large_realtime_world", game_build_id: "build_1" });
  });

  it("deploys a service stack only with the exact metered-price confirmation", async () => {
    const mock = createFetchMock(() => jsonResponse({ release: { id: "release_stack", status: "processing" } }, 202));
    const client = new GlitchClient(config, mock.fetch);
    const result = await callTool("glitch_apply_hosting_services", client, {
      site_id: "site_1",
      version: "2.0.0",
      preset: "authoritative_world",
      game_build_id: "build_1",
      expected_monthly_floor_cents: 9999,
      billing_confirmation: "DEPLOY HOSTING STACK AT ESTIMATED FLOOR 9999 CENTS PER MONTH PLUS USAGE",
      confirm: true
    });

    expect(result.isError).toBeUndefined();
    expect(mock.requests[0]?.url).toBe("https://mcp.example.test/mcp/v1/titles/title_default/hosting/sites/site_1/services/apply");
    expect(mock.requests[0]?.body).toMatchObject({
      version: "2.0.0",
      preset: "authoritative_world",
      expected_monthly_floor_cents: 9999,
      confirm: true
    });
  });

  it("rejects a service-stack deployment before any network call when confirmation is wrong", async () => {
    const mock = createFetchMock(() => jsonResponse({}));
    const client = new GlitchClient(config, mock.fetch);
    const result = await safeTool(() => callTool("glitch_apply_hosting_services", client, {
      site_id: "site_1",
      version: "2.0.0",
      preset: "authoritative_world",
      game_build_id: "build_1",
      expected_monthly_floor_cents: 9999,
      billing_confirmation: "DEPLOY IT",
      confirm: true
    }));

    expect(result.isError).toBe(true);
    expect(mock.requests).toHaveLength(0);
  });

  it("changes a Hosting plan only with an exact price phrase and explicit confirmation", async () => {
    const mock = createFetchMock(() => jsonResponse({ action: "checkout", checkout_url: "https://checkout.stripe.test/session" }));
    const client = new GlitchClient(config, mock.fetch);
    const result = await callTool("glitch_change_hosting_plan", client, {
      plan: "growth",
      expected_monthly_price_cents: 8900,
      billing_confirmation: "CHANGE HOSTING PLAN TO GROWTH AT 8900 CENTS PER MONTH",
      confirm: true
    });

    expect(result.isError).toBeUndefined();
    expect(mock.requests[0]?.url).toBe("https://mcp.example.test/mcp/v1/titles/title_default/hosting/billing/checkout");
    expect(mock.requests[0]?.body).toEqual({
      plan: "growth",
      expected_monthly_price_cents: 8900,
      billing_confirmation: "CHANGE HOSTING PLAN TO GROWTH AT 8900 CENTS PER MONTH",
      accept_proration: false,
      confirm: true
    });
  });

  it("supports a Microsoft Marketplace Hosting plan operation without returning Stripe Checkout", async () => {
    const mock = createFetchMock(() => jsonResponse({
      action: "marketplace_plan_change_requested",
      billing_provider: "microsoft_marketplace",
      pending_plan: "growth"
    }));
    const client = new GlitchClient(config, mock.fetch);
    const result = await callTool("glitch_change_hosting_plan", client, {
      plan: "growth",
      expected_monthly_price_cents: 10900,
      billing_confirmation: "CHANGE HOSTING PLAN TO GROWTH AT 10900 CENTS PER MONTH",
      confirm: true
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("Microsoft Marketplace is processing");
    expect(mock.requests[0]?.body).toMatchObject({ expected_monthly_price_cents: 10900 });
  });

  it("returns the AWS Marketplace management link for a paid Hosting plan change", async () => {
    const mock = createFetchMock(() => jsonResponse({
      action: "aws_marketplace_plan_change_required",
      billing_provider: "aws_marketplace",
      requested_plan: "scale",
      manage_url: "https://console.aws.amazon.com/marketplace/home#/subscriptions"
    }));
    const client = new GlitchClient(config, mock.fetch);
    const result = await callTool("glitch_change_hosting_plan", client, {
      plan: "scale",
      expected_monthly_price_cents: 21900,
      billing_confirmation: "CHANGE HOSTING PLAN TO SCALE AT 21900 CENTS PER MONTH",
      confirm: true
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("Finish the paid plan change in AWS Marketplace");
    expect(result.structuredContent?.links).toContainEqual({
      name: "Manage AWS Marketplace subscription",
      url: "https://console.aws.amazon.com/marketplace/home#/subscriptions"
    });
  });

  it("does not call billing when a Hosting plan confirmation phrase is wrong", async () => {
    const mock = createFetchMock(() => jsonResponse({ action: "checkout" }));
    const client = new GlitchClient(config, mock.fetch);
    const result = await safeTool(() => callTool("glitch_change_hosting_plan", client, {
      plan: "growth",
      expected_monthly_price_cents: 8900,
      billing_confirmation: "CHANGE PLAN",
      confirm: true
    }));

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ status: "error", code: "validation_error" });
    expect(mock.requests).toHaveLength(0);
  });

  it("rejects secret-shaped Hosting configuration before it reaches Glitch", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: { id: "site_1" } }));
    const client = new GlitchClient(config, mock.fetch);
    const result = await safeTool(() => callTool("glitch_update_hosting_site", client, {
      site_id: "site_1",
      configuration: { DATABASE_URL: "postgresql://player:password@example.test/game" },
      confirm: true
    }));

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ status: "error", code: "validation_error" });
    expect(mock.requests).toHaveLength(0);
  });

  it("connects a developer-owned domain through the title-scoped Hosting route", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: { id: "domain_1", status: "pending_verification" } }, 201));
    const client = new GlitchClient(config, mock.fetch);
    const result = await callTool("glitch_connect_hosting_domain", client, {
      site_id: "site_1",
      hostname: "play.example.com",
      confirm: true
    });

    expect(result.isError).toBeUndefined();
    expect(mock.requests[0]?.url).toBe("https://mcp.example.test/titles/title_default/hosting/sites/site_1/domains");
    expect(mock.requests[0]?.body).toEqual({ hostname: "play.example.com" });
  });

  it("creates a managed database checkout with exact price confirmation", async () => {
    const mock = createFetchMock(() => jsonResponse({ checkout_url: "https://checkout.stripe.test/database", checkout_session_id: "cs_test_db" }, 202));
    const client = new GlitchClient(config, mock.fetch);
    const result = await callTool("glitch_create_hosting_database", client, {
      site_id: "site_1",
      name: "player-data",
      engine: "postgresql",
      plan: "launch",
      azure_region: "eastus",
      expected_monthly_price_cents: 1500,
      billing_confirmation: "CREATE DATABASE PLAYER-DATA ON LAUNCH AT 1500 CENTS PER MONTH",
      confirm: true
    });

    expect(result.isError).toBeUndefined();
    expect(mock.requests[0]?.url).toBe("https://mcp.example.test/mcp/v1/titles/title_default/hosting/sites/site_1/databases");
    expect(mock.requests[0]?.body).toMatchObject({
      name: "player-data",
      engine: "postgresql",
      plan: "launch",
      azure_region: "eastus",
      auto_grow_enabled: false,
      high_availability_enabled: false,
      expected_monthly_price_cents: 1500,
      confirm: true
    });
  });

  it("sends database deletion as a confirmed DELETE body with the exact name", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: { id: "db_1", status: "deleting" } }, 202));
    const client = new GlitchClient(config, mock.fetch);
    const result = await callTool("glitch_delete_hosting_database", client, {
      site_id: "site_1",
      database_id: "db_1",
      confirmation: "player-data",
      confirm: true
    });

    expect(result.isError).toBeUndefined();
    expect(mock.requests[0]?.url).toBe("https://mcp.example.test/mcp/v1/titles/title_default/hosting/sites/site_1/databases/db_1");
    expect(mock.requests[0]?.init?.method).toBe("DELETE");
    expect(mock.requests[0]?.body).toEqual({ confirmation: "player-data", confirm: true });
  });

  it("requires confirmation before Stripe Checkout can start for a managed domain", async () => {
    const mock = createFetchMock(() => jsonResponse({ checkout_url: "https://checkout.stripe.test/domain" }, 202));
    const client = new GlitchClient(config, mock.fetch);
    const result = await safeTool(() => callTool("glitch_purchase_hosting_domain", client, {
      site_id: "site_1",
      hostname: "neondrift.example",
      auto_renew: true,
      accepted_legal_terms: true,
      agreement_keys: ["agreement_1"],
      contact: {
        first_name: "Dev",
        last_name: "Studio",
        email: "dev@example.com",
        phone: "+1-555-0100",
        address_line_1: "1 Main Street",
        city: "Chicago",
        state: "IL",
        country: "US",
        postal_code: "60601"
      },
      expected_annual_price_cents: 2000,
      billing_confirmation: "PURCHASE DOMAIN neondrift.example AT 2000 CENTS PER YEAR"
    }));

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ status: "error", code: "confirmation_required" });
    expect(mock.requests).toHaveLength(0);
  });

  it("lists multiplayer lobbies for the title via the public API", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: [{ id: "lobby_1" }] }));
    const client = new GlitchClient(config, mock.fetch);
    const result = await callTool("glitch_list_multiplayer_lobbies", client, { region: "us-central", limit: 10 });

    expect(result.isError).toBeUndefined();
    expect(mock.requests[0]?.url).toBe(
      "https://mcp.example.test/titles/title_default/multiplayer/lobbies?region=us-central&limit=10"
    );
    // The HTTP client unwraps the top-level { data } envelope from the API.
    expect(result.structuredContent?.data).toEqual([{ id: "lobby_1" }]);
  });

  it("creates a multiplayer lobby with the owner player id", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: { id: "lobby_2", owner_player_id: "p1" } }));
    const client = new GlitchClient(config, mock.fetch);
    const result = await callTool("glitch_create_multiplayer_lobby", client, { player_id: "p1", max_members: 4 });

    expect(result.isError).toBeUndefined();
    expect(mock.requests[0]?.url).toBe("https://mcp.example.test/titles/title_default/multiplayer/lobbies");
    expect(mock.requests[0]?.init?.method).toBe("POST");
    expect(mock.requests[0]?.body).toMatchObject({ player_id: "p1", max_members: 4 });
  });

  it("submits a progression run with the nested payload the backend expects", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: { status: "success", run_id: "run_9" } }));
    const client = new GlitchClient(config, mock.fetch);
    const result = await callTool("glitch_submit_progression", client, {
      install_id: "install_1",
      idempotency_key: "run-abc-123",
      stats: { kills: 5 },
      scores: { kills_board: 5000 }
    });

    expect(result.isError).toBeUndefined();
    expect(mock.requests[0]?.url).toBe("https://mcp.example.test/titles/title_default/installs/install_1/submit");
    // The backend expects stats/scores nested under `payload`, plus idempotency_key.
    expect(mock.requests[0]?.body).toMatchObject({
      idempotency_key: "run-abc-123",
      payload: { stats: { kills: 5 }, scores: { kills_board: 5000 } }
    });
  });

  it("rejects a progression run with neither stats nor scores", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: {} }));
    const client = new GlitchClient(config, mock.fetch);
    await expect(
      callTool("glitch_submit_progression", client, { install_id: "install_1", idempotency_key: "run-empty" })
    ).rejects.toThrow(/stats.*scores/i);
    expect(mock.requests).toHaveLength(0);
  });

  it("stores a cloud save with slot_index, base64 payload, and an auto-computed sha256 checksum", async () => {
    const { createHash } = await import("node:crypto");
    const mock = createFetchMock(() => jsonResponse({ data: { version: 3 } }));
    const client = new GlitchClient(config, mock.fetch);
    const raw = "save-bytes-here";
    const payloadB64 = Buffer.from(raw).toString("base64");
    const expectedChecksum = createHash("sha256").update(Buffer.from(payloadB64, "base64")).digest("hex");

    const result = await callTool("glitch_store_cloud_save", client, {
      install_id: "install_1",
      slot_index: 0,
      payload: payloadB64,
      base_version: 2
    });

    expect(result.isError).toBeUndefined();
    expect(mock.requests[0]?.url).toBe("https://mcp.example.test/titles/title_default/installs/install_1/saves");
    expect(mock.requests[0]?.body).toMatchObject({
      slot_index: 0,
      payload: payloadB64,
      checksum: expectedChecksum,
      save_type: "manual",
      base_version: 2
    });
  });

  it("resolves a cloud save conflict at the resolve endpoint", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: { resolved: true } }));
    const client = new GlitchClient(config, mock.fetch);
    const result = await callTool("glitch_resolve_cloud_save_conflict", client, {
      install_id: "install_1",
      save_id: "save_1",
      conflict_id: "conflict_1",
      choice: "use_client"
    });

    expect(result.isError).toBeUndefined();
    expect(mock.requests[0]?.url).toBe("https://mcp.example.test/titles/title_default/installs/install_1/saves/save_1/resolve");
    expect(mock.requests[0]?.body).toMatchObject({ conflict_id: "conflict_1", choice: "use_client" });
  });

  it("updates a deployment status with a PUT", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: { id: "build_1", status: "published" } }));
    const client = new GlitchClient(config, mock.fetch);
    const result = await callTool("glitch_update_deployment_status", client, { build_id: "build_1", status: "published" });

    expect(result.isError).toBeUndefined();
    expect(mock.requests[0]?.url).toBe("https://mcp.example.test/titles/title_default/deployments/build_1/status");
    expect(mock.requests[0]?.init?.method).toBe("PUT");
    expect(mock.requests[0]?.body).toMatchObject({ status: "published" });
  });

  it("deploys a build end to end through the multipart flow", async () => {
    const mock = createFetchMock((req) => {
      if (req.url.endsWith("/deployments/multipart/initiate")) {
        return jsonResponse({ data: { upload_id: "upload_1", file_path: "pending_game_uploads/title_default/x.zip" } });
      }
      if (req.url.endsWith("/deployments/multipart/urls")) {
        return jsonResponse({ data: { urls: { "1": "https://s3.example.test/part-1" } } });
      }
      if (req.url === "https://s3.example.test/part-1") {
        return new Response(null, { status: 200, headers: { etag: "\"etag-1\"" } });
      }
      if (req.url.endsWith("/deployments/multipart/complete")) {
        return jsonResponse({ data: { success: true } });
      }
      if (req.url.endsWith("/deployments/confirm")) {
        return jsonResponse({ data: { id: "build_1", status: "processing" } });
      }
      return jsonResponse({ data: {} });
    });

    const client = new GlitchClient(config, mock.fetch);
    const content_base64 = Buffer.from("PK pretend zip payload").toString("base64");
    const result = await callTool("glitch_deploy_game_build", client, {
      content_base64,
      file_name: "build.zip",
      version_string: "1.0.0",
      build_type: "production",
      deployment_type: "html5"
    });

    expect(result.isError).toBeUndefined();
    const urls = mock.requests.map((r) => r.url);
    // Full order: initiate -> part urls -> S3 part PUT -> complete -> confirm.
    expect(urls.some((u) => u.endsWith("/deployments/multipart/initiate"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/deployments/multipart/urls"))).toBe(true);
    expect(urls).toContain("https://s3.example.test/part-1");
    expect(urls.some((u) => u.endsWith("/deployments/multipart/complete"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/deployments/confirm"))).toBe(true);
    // The completed upload sends the captured ETag back for the single part.
    const complete = mock.requests.find((r) => r.url.endsWith("/deployments/multipart/complete"));
    expect(complete?.body).toMatchObject({ upload_id: "upload_1", parts: [{ PartNumber: 1, ETag: "\"etag-1\"" }] });
    // The confirm step registers the build with the provided metadata.
    const confirm = mock.requests.find((r) => r.url.endsWith("/deployments/confirm"));
    expect(confirm?.body).toMatchObject({ version_string: "1.0.0", build_type: "production", deployment_type: "html5" });
    expect(result.structuredContent?.data).toMatchObject({ id: "build_1", status: "processing" });
  });
});

async function callTool(name: string, client: GlitchClient, input: Record<string, unknown>, ctx?: ToolRuntimeContext) {
  const definition = glitchToolDefinitions.find((tool) => tool.name === name);
  if (!definition) {
    throw new Error(`Missing tool ${name}`);
  }

  return definition.handler(client, input, ctx);
}
