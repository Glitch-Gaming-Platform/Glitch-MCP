import { describe, expect, it, vi } from "vitest";
import { GlitchClient } from "../src/glitchClient.js";
import { safeTool } from "../src/result.js";
import { glitchToolDefinitions } from "../src/tools.js";
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
      "glitch_get_billing_status",
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
      "glitch_list_multiplayer_lobbies",
      "glitch_create_multiplayer_lobby",
      "glitch_browse_multiplayer_servers",
      "glitch_list_multiplayer_realms",
      "glitch_create_install",
      "glitch_validate_install",
      "glitch_list_cloud_saves",
      "glitch_store_cloud_save",
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

  it("submits a progression run to the player install submit endpoint", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: { ok: true } }));
    const client = new GlitchClient(config, mock.fetch);
    const result = await callTool("glitch_submit_progression", client, {
      install_id: "install_1",
      stats: { kills: 5 },
      leaderboard_keys: ["kills_board"]
    });

    expect(result.isError).toBeUndefined();
    expect(mock.requests[0]?.url).toBe("https://mcp.example.test/titles/title_default/installs/install_1/submit");
    expect(mock.requests[0]?.body).toMatchObject({ stats: { kills: 5 }, leaderboard_keys: ["kills_board"] });
  });

  it("stores a cloud save with a base version for conflict detection", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: { version: 3 } }));
    const client = new GlitchClient(config, mock.fetch);
    const result = await callTool("glitch_store_cloud_save", client, {
      install_id: "install_1",
      key: "slot_1",
      data: "{\"hp\":100}",
      base_version: 2
    });

    expect(result.isError).toBeUndefined();
    expect(mock.requests[0]?.url).toBe("https://mcp.example.test/titles/title_default/installs/install_1/saves");
    expect(mock.requests[0]?.body).toMatchObject({ key: "slot_1", base_version: 2 });
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

async function callTool(name: string, client: GlitchClient, input: Record<string, unknown>) {
  const definition = glitchToolDefinitions.find((tool) => tool.name === name);
  if (!definition) {
    throw new Error(`Missing tool ${name}`);
  }

  return definition.handler(client, input);
}
