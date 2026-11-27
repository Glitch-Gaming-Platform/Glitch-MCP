import { mkdtemp, writeFile } from "node:fs/promises";
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
  defaultTitleId: "title_default",
  token: "glitch-user-token"
};

const base = "https://mcp.example.test/mcp/v1/titles/title_default/distribution";

function callTool(name: string, client: GlitchClient, input: Record<string, unknown>) {
  const definition = glitchToolDefinitions.find((tool) => tool.name === name);
  if (!definition) {
    throw new Error(`Missing tool ${name}`);
  }
  return safeTool(() => definition.handler(client, input));
}

function submission(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_1",
    platform: "itch",
    channel: "html5",
    status: "queued",
    stage: "queued",
    dry_run: true,
    actions: [],
    preflight: [],
    error: null,
    ...overrides
  };
}

describe("distribution tools", () => {
  it("links the distribution dashboard page", () => {
    const client = new GlitchClient(config);
    expect(client.dashboardUrl("distribution", { titleId: "t 1" })).toBe("https://app.example.test/games/admin/t%201/distribution");
  });

  it("rejects a real push without confirm before calling Glitch", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: submission() }));
    const client = new GlitchClient(config, mock.fetch);

    const result = await callTool("glitch_submit_distribution", client, {
      platform: "itch",
      artifact_id: "art_1",
      dry_run: false
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ status: "error", code: "confirmation_required" });
    expect(String(result.structuredContent?.message)).toContain("dry_run=true first");
    expect(mock.requests).toHaveLength(0);
  });

  it("dry-runs by default and generates an idempotency key", async () => {
    const mock = createFetchMock(() => jsonResponse({ data: { ...submission(), created: true } }, 202));
    const client = new GlitchClient(config, mock.fetch);

    const result = await callTool("glitch_submit_distribution", client, { platform: "itch", artifact_id: "art_1" });

    expect(result.isError).toBeUndefined();
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0]?.url).toBe(`${base}/submissions`);
    expect(mock.requests[0]?.init?.method).toBe("POST");
    const body = mock.requests[0]?.body as Record<string, unknown>;
    expect(body).toMatchObject({ platform: "itch", artifact_id: "art_1", dry_run: true });
    expect(body).not.toHaveProperty("confirm");
    expect(body.idempotency_key).toMatch(/^mcp-[0-9a-f-]{36}$/);
    expect(result.structuredContent?.data).toMatchObject({ idempotency_key: body.idempotency_key });
  });

  it("sends confirm and the caller's idempotency key on a confirmed push", async () => {
    const mock = createFetchMock(() => jsonResponse({
      data: { ...submission({ dry_run: false }), created: false, dashboard_url: "https://app.example.test/games/admin/title_default/distribution" }
    }, 202));
    const client = new GlitchClient(config, mock.fetch);

    const result = await callTool("glitch_submit_distribution", client, {
      platform: "meta_quest",
      artifact_id: "art_1",
      channel: "ALPHA",
      dry_run: false,
      confirm: true,
      options: { age_group: "TEENS_AND_ADULTS" },
      idempotency_key: "release-1.4.2-quest"
    });

    expect(result.isError).toBeUndefined();
    expect(mock.requests[0]?.body).toMatchObject({
      platform: "meta_quest",
      dry_run: false,
      confirm: true,
      channel: "ALPHA",
      options: { age_group: "TEENS_AND_ADULTS" },
      idempotency_key: "release-1.4.2-quest"
    });
    expect(String(result.structuredContent?.summary)).toContain("matched an existing submission");
  });

  it("surfaces the backend's structured distribution error with remediation", async () => {
    const mock = createFetchMock(() => jsonResponse({
      message: "The submission did not pass preflight: Choose an age group.",
      code: "preflight_failed",
      retryable: false,
      remediation: "Fix the listed issues and submit again.",
      context: { issues: [{ level: "error", code: "quest_age_group_required", message: "Choose an age group." }] }
    }, 422));
    const client = new GlitchClient(config, mock.fetch);

    const result = await callTool("glitch_submit_distribution", client, { platform: "meta_quest", artifact_id: "art_1" });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: "validation_error",
      details: {
        upstreamCode: "preflight_failed",
        retryable: false,
        remediation: "Fix the listed issues and submit again.",
        upstreamContext: { issues: [expect.objectContaining({ code: "quest_age_group_required" })] }
      }
    });
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining("Next step: Fix the listed issues and submit again.") });
  });

  it("uploads a local artifact to the presigned URL without Glitch auth, then completes it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glitch-distribution-"));
    const filePath = join(dir, "game-release.apk");
    const bytes = Buffer.from("PK\u0003\u0004 fake apk payload");
    await writeFile(filePath, bytes);

    const uploadUrl = "https://storage.example.test/distribution/art_1.apk?X-Amz-Signature=abc";
    const mock = createFetchMock((request) => {
      if (request.url === `${base}/artifacts`) {
        return jsonResponse({
          data: {
            artifact: { id: "art_1", kind: "apk", status: "pending_upload", filename: "game-release.apk" },
            upload_url: uploadUrl,
            upload_method: "PUT",
            upload_headers: { "Content-Type": "application/vnd.android.package-archive", Authorization: "Bearer should-not-forward" },
            expires_in_seconds: 14400
          }
        }, 201);
      }
      if (request.url === uploadUrl) {
        return new Response(null, { status: 200 });
      }
      if (request.url === `${base}/artifacts/art_1/complete`) {
        return jsonResponse({
          data: {
            id: "art_1",
            kind: "apk",
            status: "ready",
            filename: "game-release.apk",
            size_bytes: bytes.byteLength,
            version_code: 42,
            inspection: { valid: true, issues: [{ level: "warning", code: "zip_entries_high", message: "Large zip." }] }
          }
        });
      }
      return jsonResponse({ message: "unexpected" }, 500);
    });
    const client = new GlitchClient(config, mock.fetch, undefined, { allowLocalFileReads: true });

    const result = await callTool("glitch_upload_distribution_artifact", client, { file_path: filePath, version_code: 42 });

    expect(result.isError).toBeUndefined();
    expect(mock.requests.map((request) => request.url)).toEqual([`${base}/artifacts`, uploadUrl, `${base}/artifacts/art_1/complete`]);

    expect(mock.requests[0]?.body).toEqual({ kind: "apk", filename: "game-release.apk", size_bytes: bytes.byteLength, version_code: 42 });
    expect(new Headers(mock.requests[0]?.init?.headers).get("authorization")).toBe("Bearer glitch-user-token");

    const put = mock.requests[1];
    expect(put?.init?.method).toBe("PUT");
    const putHeaders = new Headers(put?.init?.headers);
    expect(putHeaders.get("authorization")).toBeNull();
    expect(putHeaders.get("content-type")).toBe("application/vnd.android.package-archive");
    expect(put?.init?.body).toBeInstanceOf(Blob);
    const uploaded = Buffer.from(await (put?.init?.body as Blob).arrayBuffer());
    expect(uploaded.equals(bytes)).toBe(true);

    expect(new Headers(mock.requests[2]?.init?.headers).get("authorization")).toBe("Bearer glitch-user-token");
    expect(result.structuredContent?.data).toMatchObject({ id: "art_1", status: "ready" });
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining("zip_entries_high") });
  });

  it("requires kind for zips and refuses local reads over HTTP", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glitch-distribution-"));
    const filePath = join(dir, "build.zip");
    await writeFile(filePath, Buffer.from("PK"));
    const mock = createFetchMock(() => jsonResponse({ data: {} }));

    const stdio = new GlitchClient(config, mock.fetch, undefined, { allowLocalFileReads: true });
    const zip = await callTool("glitch_upload_distribution_artifact", stdio, { file_path: filePath });
    expect(zip.structuredContent).toMatchObject({ code: "validation_error", message: expect.stringContaining("web_zip") });

    const http = new GlitchClient(config, mock.fetch, undefined, { allowLocalFileReads: false });
    const refused = await callTool("glitch_upload_distribution_artifact", http, { file_path: filePath, kind: "web_zip" });
    expect(refused.structuredContent).toMatchObject({ code: "validation_error" });
    expect(mock.requests).toHaveLength(0);
  });

  it("connects a store without ever echoing credentials", async () => {
    const secret = "amzn-super-secret-value-123";
    const mock = createFetchMock(() => jsonResponse({
      data: {
        id: "conn_1",
        platform: "amazon_appstore",
        status: "connected",
        credential_hint: "••••e-123",
        credentials_set: { client_id: true, client_secret: true },
        public_credentials: { client_id: "amzn1.client.public" },
        external_app_id: "amzn1.devportal.mobileapp.abc",
        // A misbehaving backend must still never leak the secret to the model.
        credentials: { client_secret: secret },
        last_error: `rejected ${secret}`
      }
    }));
    const client = new GlitchClient(config, mock.fetch);

    const unconfirmed = await callTool("glitch_connect_distribution_store", client, {
      platform: "amazon_appstore",
      credentials: { client_id: "amzn1.client.public", client_secret: secret }
    });
    expect(unconfirmed.structuredContent).toMatchObject({ code: "confirmation_required" });
    expect(mock.requests).toHaveLength(0);

    const result = await callTool("glitch_connect_distribution_store", client, {
      platform: "amazon_appstore",
      credentials: { client_id: "amzn1.client.public", client_secret: secret },
      external_app_id: "amzn1.devportal.mobileapp.abc",
      confirm: true
    });

    expect(result.isError).toBeUndefined();
    expect(mock.requests[0]?.url).toBe(`${base}/connections/amazon_appstore`);
    expect(mock.requests[0]?.init?.method).toBe("PUT");
    expect(mock.requests[0]?.body).toMatchObject({ credentials: { client_secret: secret } });

    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result.structuredContent?.data).not.toHaveProperty("credentials");
    expect(result.structuredContent?.data).toMatchObject({
      status: "connected",
      credentials_set: { client_secret: true },
      public_credentials: { client_id: "amzn1.client.public" }
    });
  });

  it("updates settings with PATCH and maps submission actions and reports", async () => {
    const mock = createFetchMock((request) => {
      if (request.url.endsWith("/connections/meta_quest")) {
        return jsonResponse({ data: { platform: "meta_quest", status: "connected", settings: { age_group: "MIXED_AGES" } } });
      }
      if (request.url.endsWith("/submissions/sub_1/result")) {
        return jsonResponse({ data: submission({ status: "submitted" }) });
      }
      if (request.url.endsWith("/submissions/sub_1")) {
        return jsonResponse({
          data: submission({
            status: "needs_action",
            actions: [
              { label: "Set these environment variables", env: { BUTLER_API_KEY: "" }, kind: "env" },
              { label: "Run", command: "butler push build.zip studio/game:html5", kind: "command" },
              { label: "Report the result to Glitch", command: "curl -X POST https://api.example.test/api/distribution/handoff/sub_1", kind: "report" }
            ]
          })
        });
      }
      return jsonResponse({ data: {} });
    });
    const client = new GlitchClient(config, mock.fetch);

    const updated = await callTool("glitch_update_distribution_store_settings", client, {
      platform: "meta_quest",
      settings: { age_group: "MIXED_AGES" },
      confirm: true
    });
    expect(updated.isError).toBeUndefined();
    expect(mock.requests[0]?.init?.method).toBe("PATCH");

    const fetched = await callTool("glitch_get_distribution_submission", client, { submission_id: "sub_1" });
    const text = String(fetched.content[0] && "text" in fetched.content[0] ? fetched.content[0].text : "");
    expect(text).toContain("butler push build.zip studio/game:html5");
    expect(text).toContain("`BUTLER_API_KEY`");
    expect(text).toContain("glitch_report_distribution_result");
    expect(text).not.toContain("curl -X POST");

    const reported = await callTool("glitch_report_distribution_result", client, {
      submission_id: "sub_1",
      status: "submitted",
      external_build_id: "12345",
      log: "pushed"
    });
    expect(reported.isError).toBeUndefined();
    expect(mock.requests.at(-1)?.url).toBe(`${base}/submissions/sub_1/result`);
    expect(mock.requests.at(-1)?.body).toEqual({ status: "submitted", external_build_id: "12345", log: "pushed" });

    await callTool("glitch_list_distribution_submissions", client, { platform: "itch", status: ["needs_action", "failed"], per_page: 5 });
    expect(mock.requests.at(-1)?.url).toBe(`${base}/submissions?platform=itch&status=needs_action%2Cfailed&per_page=5`);

    const cancel = await callTool("glitch_cancel_distribution_submission", client, { submission_id: "sub_1" });
    expect(cancel.structuredContent).toMatchObject({ code: "confirmation_required" });
  });
});
