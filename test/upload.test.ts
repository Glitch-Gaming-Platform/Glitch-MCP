import { mkdtemp, truncate, writeFile } from "node:fs/promises";
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
