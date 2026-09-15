import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { GlitchClient } from "../src/glitchClient.js";
import { createGlitchMcpServer } from "../src/server.js";
import { glitchToolDefinitions } from "../src/tools.js";
import { createFetchMock, expectAuthorization, jsonResponse } from "./helpers.js";

const config = { apiBaseUrl: "https://api.example.test/api", dashboardBaseUrl: "https://app.example.test", timeoutMs: 1000, clientName: "test", defaultTitleId: "title/default", token: "test-mcp-token" };
const id = "4c9dfe7a-3bcb-48b0-9865-c2c1aadad7e2";
const tool = (name: string) => {
  const result = glitchToolDefinitions.find(definition => definition.name === name);
  if (!result) throw new Error(`Missing tool ${name}`);
  return result;
};

const definitions = [
  { name: "leaderboard", resource: "leaderboards", idField: "leaderboard_id", fields: { api_key: "best", name: "Best", sort_order: "desc", display_type: "distance", write_policy: "client" } },
  { name: "achievement", resource: "achievements", idField: "achievement_id", fields: { api_key: "first", name: "First", description: "First win", is_hidden: true, progress_stat_id: id, unlock_threshold: 5, tiered_data: { bronze: 5 }, icon_locked_url: "https://cdn.example.test/locked.png", icon_unlocked_url: "https://cdn.example.test/unlocked.png" } },
  { name: "stat_definition", resource: "stats", idField: "stat_id", fields: { api_key: "wins", display_name: "Wins", type: "int", aggregation_policy: "sum", default_value: 0, min_value: 0, max_value: 100, max_delta: 5, increment_only: true } },
  { name: "progression_season", resource: "seasons", idField: "season_id", fields: { name: "Autumn", start_date: "2026-09-01T00:00:00Z", end_date: "2026-12-01T00:00:00Z", is_active: true } }
];

describe("progression MCP management", () => {
  for (const definition of definitions) {
    it(`creates, partially updates and deletes ${definition.resource} with reviewed bodies`, async () => {
      const mock = createFetchMock(request => request.init?.method === "DELETE" ? new Response(null, { status: 204 }) : jsonResponse({ data: { id, ...definition.fields } }));
      const client = new GlitchClient(config, mock.fetch);
      const create = tool(`glitch_create_${definition.name}`);
      await expect(create.handler(client, definition.fields)).rejects.toThrow(/confirm/i);
      expect(mock.requests).toHaveLength(0);
      await create.handler(client, { ...definition.fields, confirm: true });
      const nameField = definition.name === "stat_definition" ? "display_name" : "name";
      await tool(`glitch_update_${definition.name}`).handler(client, { [definition.idField]: id, [nameField]: "Updated", confirm: true });
      const deleted = await tool(`glitch_delete_${definition.name}`).handler(client, { [definition.idField]: id, confirm: true });
      expect(deleted.isError).toBeUndefined();
      expect(mock.requests.map(request => request.init?.method)).toEqual(["POST", "PUT", "DELETE"]);
      expect(mock.requests[0]?.body).toEqual({ ...definition.fields, confirm: true });
      expect(mock.requests[1]?.body).toEqual({ [nameField]: "Updated", confirm: true });
      expect(mock.requests[2]?.body).toEqual({ confirm: true });
      expect(mock.requests[1]?.url).toBe(`https://api.example.test/api/titles/title%2Fdefault/progression/${definition.resource}/${id}`);
      mock.requests.forEach(request => expectAuthorization(request.init, "test-mcp-token"));
      expect(create.readOnlyHint).toBe(false);
      expect(tool(`glitch_delete_${definition.name}`).destructiveHint).toBe(true);
    });
  }

  it("keeps explicit nulls and false values during achievement updates", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: { id } }));
    await tool("glitch_update_achievement").handler(new GlitchClient(config, mock.fetch), { achievement_id: id, progress_stat_id: null, icon_locked_url: null, is_hidden: false, confirm: true });
    expect(mock.requests[0]?.body).toEqual({ progress_stat_id: null, icon_locked_url: null, is_hidden: false, confirm: true });
  });

  it.each([
    ["glitch_update_achievement", { achievement_id: id, confirm: true }],
    ["glitch_create_achievement", { api_key: "wins", name: "Wins", description: "Win", progress_stat_id: id, unlock_threshold: 0, confirm: true }],
    ["glitch_create_leaderboard", { ...definitions[0]!.fields, display_type: "bogus", confirm: true }],
    ["glitch_create_progression_season", { name: "Bad", start_date: "2026-12-01T00:00:00Z", end_date: "2026-09-01T00:00:00Z", confirm: true }],
    ["glitch_create_stat_definition", { ...definitions[2]!.fields, default_value: Infinity, confirm: true }],
    ["glitch_delete_leaderboard", { leaderboard_id: "../escape", confirm: true }],
    ["glitch_create_progression_test_install", { user_id: id, confirm: true }],
    ["glitch_submit_progression", { install_id: id, idempotency_key: "empty", stats: {}, scores: {}, confirm: true }],
    ["glitch_submit_progression", { install_id: id, idempotency_key: "unapproved", stats: { wins: 1 } }],
    ["glitch_read_leaderboard", { api_key: "best", around_me: true }]
  ])("rejects invalid/unapproved %s before network access", async (name, input) => {
    const mock = createFetchMock(() => jsonResponse({ data: {} }));
    await expect(tool(name as string).handler(new GlitchClient(config, mock.fetch), input as Record<string, unknown>)).rejects.toThrow();
    expect(mock.requests).toHaveLength(0);
  });

  it("forwards every standings filter and run metadata", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: {} }));
    const client = new GlitchClient(config, mock.fetch);
    await tool("glitch_read_leaderboard").handler(client, { title_id: id, api_key: "best/time", season_id: id, around_me: true, install_id: id, limit: 50, page: 2 });
    const url = new URL(mock.requests[0]!.url);
    expect(url.pathname).toBe(`/api/titles/${id}/leaderboards/best%2Ftime`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ season_id: id, around_me: "1", install_id: id, limit: "50", page: "2" });
    await tool("glitch_submit_progression").handler(client, { install_id: id, idempotency_key: "run-once", stats: { wins: 1 }, scores: { best: 15 }, metadata: { mode: "test" }, trust_level: "server_authoritative", confirm: true });
    expect(mock.requests[1]?.body).toEqual({ idempotency_key: "run-once", payload: { stats: { wins: 1 }, scores: { best: 15 }, metadata: { mode: "test" } }, trust_level: "server_authoritative", confirm: true });
  });

  it("supports stats, seasons, player state and a confirmed developer test install", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: [] }));
    const client = new GlitchClient(config, mock.fetch);
    for (const name of ["glitch_list_stat_definitions", "glitch_list_progression_seasons", "glitch_list_player_stats", "glitch_create_progression_test_install"]) {
      await tool(name).handler(client, name === "glitch_list_player_stats" ? { install_id: id } : name === "glitch_create_progression_test_install" ? { confirm: true } : {});
    }
    expect(mock.requests.map(request => new URL(request.url).pathname)).toEqual([
      "/api/titles/title%2Fdefault/progression/stats", "/api/titles/title%2Fdefault/progression/seasons",
      `/api/titles/title%2Fdefault/installs/${id}/stats`, "/api/titles/title%2Fdefault/progression/test-install"
    ]);
  });

  it("links definition lists to the matching game-admin pages", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: [] }));
    const client = new GlitchClient(config, mock.fetch);
    for (const [name, page] of [["glitch_list_leaderboards", "leaderboards"], ["glitch_list_achievement_definitions", "achievements"]]) {
      const result = await tool(name!).handler(client, { title_id: id });
      expect(JSON.stringify(result)).toContain(`https://app.example.test/games/admin/${id}/${page}`);
    }
  });

  it("uploads icons using scoped multipart without creating an agent or social asset", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: { url: "https://cdn.example.test/icon.png" } }));
    const client = new GlitchClient(config, mock.fetch);
    const input = { file_name: "icon.png", content_base64: "iVBORw0KGgo=", confirm: true };
    const response = await tool("glitch_upload_achievement_icon").handler(client, input);
    expect(response.structuredContent?.data).toEqual({ url: "https://cdn.example.test/icon.png" });
    expect(mock.requests[0]?.url).toBe("https://api.example.test/api/titles/title%2Fdefault/progression/icons");
    const form = mock.requests[0]?.init?.body as FormData;
    expect(form.get("confirm")).toBe("1");
    expect((form.get("media") as File).type).toBe("image/png");
    await expect(tool("glitch_upload_achievement_icon").handler(client, { file_path: "/etc/passwd", confirm: true })).rejects.toThrow(/disabled/i);
    await expect(tool("glitch_upload_achievement_icon").handler(client, { ...input, mime_type: "image/svg+xml" })).rejects.toThrow(/PNG/);
    await expect(tool("glitch_upload_achievement_icon").handler(client, { ...input, confirm: false })).rejects.toThrow(/confirm/i);
    expect(mock.requests).toHaveLength(1);
  });

  it("advertises schemas and invokes management through the actual MCP protocol", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: { id, name: "Winner" } }, 201));
    const server = createGlitchMcpServer({ config, client: new GlitchClient(config, mock.fetch) });
    const client = new Client({ name: "progression-test", version: "1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const tools = await client.listTools();
      const schema = tools.tools.find(item => item.name === "glitch_create_achievement")!;
      expect(schema.inputSchema.required).toEqual(expect.arrayContaining(["api_key", "name", "description"]));
      expect(schema.annotations?.readOnlyHint).toBe(false);
      const rejected = await client.callTool({ name: "glitch_create_achievement", arguments: { api_key: "winner", name: "Winner", description: "Win" } });
      expect(rejected.isError).toBe(true);
      expect(mock.requests).toHaveLength(0);
      const created = await client.callTool({ name: "glitch_create_achievement", arguments: { api_key: "winner", name: "Winner", description: "Win", confirm: true } });
      expect(created.isError).toBeUndefined();
      expect(created.structuredContent?.data).toMatchObject({ id, name: "Winner" });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
