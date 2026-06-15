import { mkdir, mkdtemp, readFile, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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

function callTool(name: string, client: GlitchClient, input: Record<string, unknown>) {
  const definition = glitchToolDefinitions.find((tool) => tool.name === name);
  if (!definition) {
    throw new Error(`Missing tool ${name}`);
  }
  // Mirror how the server invokes handlers so thrown errors become tool error results.
  return safeTool(() => definition.handler(client, input));
}

describe("glitch_upload_file", () => {
  it("uploads a local file path as multipart when local reads are allowed (stdio)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glitch-upload-"));
    const filePath = join(dir, "screenshot.png");
    await writeFile(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const mock = createFetchMock(() => jsonResponse({ data: { id: "file_1", kind: "image" } }));
    const client = new GlitchClient(config, mock.fetch, undefined, { allowLocalFileReads: true });

    const result = await callTool("glitch_upload_file", client, { file_path: filePath });

    expect(result.isError).toBeUndefined();
    expect(mock.requests[0]?.url).toBe("https://mcp.example.test/mcp/v1/titles/title_default/files");
    // FormData body is passed through (not JSON-stringified).
    expect(mock.requests[0]?.init?.body).toBeInstanceOf(FormData);
    const form = mock.requests[0]?.init?.body as FormData;
    const file = form.get("file");
    expect(file).toBeInstanceOf(Blob);
    expect((file as File).name).toBe("screenshot.png");
    expect((file as Blob).type).toBe("image/png");
    expect(result.structuredContent?.data).toEqual({ id: "file_1", kind: "image" });
  });

  it("refuses to read local file paths when local reads are disabled (HTTP)", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: {} }));
    const client = new GlitchClient(config, mock.fetch, undefined, { allowLocalFileReads: false });

    const result = await callTool("glitch_upload_file", client, { file_path: "/etc/passwd" });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ status: "error", code: "validation_error" });
    expect(mock.requests).toHaveLength(0);
  });

  it("blocks local file paths outside configured upload roots", async () => {
    const allowedDir = await mkdtemp(join(tmpdir(), "glitch-upload-allowed-"));
    const outsideDir = await mkdtemp(join(tmpdir(), "glitch-upload-outside-"));
    const filePath = join(outsideDir, "brief.pdf");
    await writeFile(filePath, Buffer.from("%PDF-1.4"));

    const mock = createFetchMock(() => jsonResponse({ data: {} }));
    const client = new GlitchClient(
      { ...config, uploadAllowedRoots: [allowedDir] },
      mock.fetch,
      undefined,
      { allowLocalFileReads: true }
    );

    const result = await callTool("glitch_upload_file", client, { file_path: filePath });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: "permission_denied" });
    expect(mock.requests).toHaveLength(0);
  });

  it("rejects oversized local files before reading them into memory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glitch-upload-large-"));
    const filePath = join(dir, "clip.mp4");
    await writeFile(filePath, Buffer.alloc(0));
    await truncate(filePath, 51 * 1024 * 1024);

    const mock = createFetchMock(() => jsonResponse({ data: {} }));
    const client = new GlitchClient(config, mock.fetch, undefined, { allowLocalFileReads: true });

    const result = await callTool("glitch_upload_file", client, { file_path: filePath });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: "validation_error" });
    expect(mock.requests).toHaveLength(0);
  });

  it("uploads base64 content and infers mime type from the file name", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: { id: "file_2", kind: "video" } }));
    const client = new GlitchClient(config, mock.fetch, undefined, { allowLocalFileReads: false });

    const result = await callTool("glitch_upload_file", client, {
      content_base64: Buffer.from("hello clip").toString("base64"),
      file_name: "trailer.mp4"
    });

    expect(result.isError).toBeUndefined();
    const form = mock.requests[0]?.init?.body as FormData;
    expect((form.get("file") as Blob).type).toBe("video/mp4");
  });

  it("requires file_name when uploading base64 content", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: {} }));
    const client = new GlitchClient(config, mock.fetch);

    const result = await callTool("glitch_upload_file", client, {
      content_base64: Buffer.from("x").toString("base64")
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: "validation_error" });
    expect(mock.requests).toHaveLength(0);
  });

  it("rejects invalid base64 content", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: {} }));
    const client = new GlitchClient(config, mock.fetch);

    const result = await callTool("glitch_upload_file", client, {
      content_base64: "not valid base64!",
      file_name: "brief.pdf"
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: "validation_error" });
    expect(mock.requests).toHaveLength(0);
  });

  it("rejects unknown extensions with no mime_type", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: {} }));
    const client = new GlitchClient(config, mock.fetch);

    const result = await callTool("glitch_upload_file", client, {
      content_base64: Buffer.from("x").toString("base64"),
      file_name: "mystery.bin"
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: "validation_error" });
  });

  it("forwards agent_run_id and the per-request token", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: { id: "file_3" } }));
    const client = new GlitchClient({ ...config, token: "cfg" }, mock.fetch, undefined, {
      allowLocalFileReads: false,
      authToken: "caller-token"
    });

    await callTool("glitch_upload_file", client, {
      content_base64: Buffer.from("data").toString("base64"),
      file_name: "brief.pdf",
      agent_run_id: "run_9"
    });

    const form = mock.requests[0]?.init?.body as FormData;
    expect(form.get("agent_run_id")).toBe("run_9");
    const headers = new Headers(mock.requests[0]?.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer caller-token");
    // fetch sets multipart Content-Type itself; we must not force application/json.
    expect(headers.get("content-type")).not.toBe("application/json");
  });
});

describe("local social asset tools", () => {
  it("creates the conventional folders and writes scan config", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "glitch-social-project-"));
    const mock = createFetchMock(() => jsonResponse({ data: {} }));
    const client = new GlitchClient(config, mock.fetch, undefined, { allowLocalFileReads: true });

    const result = await callTool("glitch_setup_social_asset_folders", client, {
      project_root: projectRoot,
      confirm: true
    });

    expect(result.isError).toBeUndefined();
    const data = result.structuredContent?.data as { folders: string[]; config_path: string; watch_config_path: string };
    expect(data.folders).toContain("screenshots");
    expect(data.folders).toContain("builds/latest/social");

    const configFile = JSON.parse(await readFile(data.config_path, "utf8")) as { asset_roots: string[] };
    expect(configFile.asset_roots).toContain("trailers");
    expect(configFile.asset_roots).toContain(".glitch/social-assets");
    const watchConfig = JSON.parse(await readFile(data.watch_config_path, "utf8")) as { enabled: boolean; interval_hours: number };
    expect(watchConfig.enabled).toBe(false);
    expect(watchConfig.interval_hours).toBe(24);
    expect(mock.requests).toHaveLength(0);
  });

  it("scans local social folders and writes a candidate manifest", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "glitch-social-project-"));
    await mkdir(join(projectRoot, "screenshots"), { recursive: true });
    await writeFile(join(projectRoot, "screenshots", "vertical-gameplay.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const mock = createFetchMock(() => jsonResponse({ data: {} }));
    const client = new GlitchClient(config, mock.fetch, undefined, { allowLocalFileReads: true });

    const result = await callTool("glitch_scan_local_social_assets", client, {
      project_root: projectRoot,
      max_files: 10
    });

    expect(result.isError).toBeUndefined();
    const data = result.structuredContent?.data as {
      candidates: Array<{ id: string; sha256: string; relative_path: string; suggested_platforms: string[] }>;
      manifest_path: string;
    };
    expect(data.candidates).toHaveLength(1);
    expect(data.candidates[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(data.candidates[0]?.relative_path).toBe("screenshots/vertical-gameplay.png");
    expect(data.candidates[0]?.suggested_platforms).toContain("instagram");

    const manifest = JSON.parse(await readFile(data.manifest_path, "utf8")) as { candidates: unknown[] };
    expect(manifest.candidates).toHaveLength(1);
  });

  it("dedupes repeated local social candidates by content hash", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "glitch-social-project-"));
    await mkdir(join(projectRoot, "screenshots"), { recursive: true });
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]);
    await writeFile(join(projectRoot, "screenshots", "boss-gameplay.png"), bytes);
    await writeFile(join(projectRoot, "screenshots", "boss-copy.png"), bytes);

    const mock = createFetchMock(() => jsonResponse({ data: {} }));
    const client = new GlitchClient(config, mock.fetch, undefined, { allowLocalFileReads: true });

    const result = await callTool("glitch_scan_local_social_assets", client, {
      project_root: projectRoot,
      max_files: 10
    });

    expect(result.isError).toBeUndefined();
    const data = result.structuredContent?.data as { candidates: Array<{ sha256: string }> };
    expect(data.candidates).toHaveLength(1);
  });

  it("can activate and stop the opt-in local social asset watcher", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "glitch-social-project-"));
    await mkdir(join(projectRoot, "captures"), { recursive: true });

    const mock = createFetchMock(() => jsonResponse({ data: {} }));
    const client = new GlitchClient(config, mock.fetch, undefined, { allowLocalFileReads: true });

    const start = await callTool("glitch_start_social_asset_watch", client, {
      project_root: projectRoot,
      run_immediately: false,
      confirm: true
    });

    expect(start.isError).toBeUndefined();
    const startData = start.structuredContent?.data as { enabled: boolean; interval_hours: number; watch_config_path: string };
    expect(startData.enabled).toBe(true);
    expect(startData.interval_hours).toBe(24);
    const activeConfig = JSON.parse(await readFile(startData.watch_config_path, "utf8")) as { enabled: boolean };
    expect(activeConfig.enabled).toBe(true);

    const stop = await callTool("glitch_stop_social_asset_watch", client, {
      project_root: projectRoot
    });

    expect(stop.isError).toBeUndefined();
    const stoppedConfig = JSON.parse(await readFile(startData.watch_config_path, "utf8")) as { enabled: boolean };
    expect(stoppedConfig.enabled).toBe(false);
  });

  it("uploads selected scan candidates as Media with scheduler metadata", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "glitch-social-project-"));
    await mkdir(join(projectRoot, "captures"), { recursive: true });
    await writeFile(join(projectRoot, "captures", "boss-gameplay.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const scanClient = new GlitchClient(config, createFetchMock(() => jsonResponse({ data: {} })).fetch, undefined, {
      allowLocalFileReads: true
    });
    const scanResult = await callTool("glitch_scan_local_social_assets", scanClient, { project_root: projectRoot });
    const scanData = scanResult.structuredContent?.data as { candidates: Array<{ id: string }> };
    const candidateId = scanData.candidates[0]?.id;
    if (!candidateId) {
      throw new Error("Expected scan to find a social asset candidate.");
    }

    const mock = createFetchMock(() =>
      jsonResponse({
        data: {
          media: { id: "media_1" },
          ai_processing_queued: true,
          title_update_pending: true
        }
      }, 201)
    );
    const client = new GlitchClient(config, mock.fetch, undefined, { allowLocalFileReads: true });

    const result = await callTool("glitch_upload_social_asset_candidates", client, {
      project_root: projectRoot,
      candidate_ids: [candidateId],
      title_promotion_schedule_id: "schedule_1",
      platforms: ["twitter", "reddit"],
      confirm: true
    });

    expect(result.isError).toBeUndefined();
    expect(mock.requests[0]?.url).toBe("https://mcp.example.test/mcp/v1/titles/title_default/media");
    expect(mock.requests[0]?.init?.body).toBeInstanceOf(FormData);

    const form = mock.requests[0]?.init?.body as FormData;
    const file = form.get("media");
    expect(file).toBeInstanceOf(Blob);
    expect((file as File).name).toBe("boss-gameplay.png");
    expect((file as Blob).type).toBe("image/png");
    expect(form.get("create_title_update")).toBe("1");
    expect(form.get("title_promotion_schedule_id")).toBe("schedule_1");
    expect(JSON.parse(String(form.get("platforms")))).toEqual(["twitter", "reddit"]);

    const sourceMetadata = JSON.parse(String(form.get("source_metadata"))) as { candidate_id: string; source: string; sha256: string };
    expect(sourceMetadata).toMatchObject({
      candidate_id: candidateId,
      source: "mcp_local_social_asset"
    });
    expect(sourceMetadata.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("requires an explicit scheduler id before uploading assets that create TitleUpdates", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "glitch-social-project-"));
    await mkdir(join(projectRoot, "captures"), { recursive: true });
    await writeFile(join(projectRoot, "captures", "boss-gameplay.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const mock = createFetchMock(() => jsonResponse({ data: {} }));
    const client = new GlitchClient(config, mock.fetch, undefined, { allowLocalFileReads: true });

    const result = await callTool("glitch_upload_social_asset_candidates", client, {
      project_root: projectRoot,
      file_paths: ["captures/boss-gameplay.png"],
      confirm: true
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: "validation_error" });
    expect(mock.requests).toHaveLength(0);
  });
});
