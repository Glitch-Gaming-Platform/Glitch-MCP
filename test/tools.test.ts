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
      "glitch_create_upload_url",
      "glitch_upload_file",
      "glitch_open_dashboard"
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
});

async function callTool(name: string, client: GlitchClient, input: Record<string, unknown>) {
  const definition = glitchToolDefinitions.find((tool) => tool.name === name);
  if (!definition) {
    throw new Error(`Missing tool ${name}`);
  }

  return definition.handler(client, input);
}
