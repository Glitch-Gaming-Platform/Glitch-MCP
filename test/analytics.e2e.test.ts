import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { GlitchClient } from "../src/glitchClient.js";
import { createGlitchMcpServer } from "../src/server.js";
import { createFetchMock, jsonResponse } from "./helpers.js";

const config = {
  apiBaseUrl: "https://mcp.example.test",
  dashboardBaseUrl: "https://app.example.test",
  timeoutMs: 1000,
  clientName: "test-client",
  defaultTitleId: "title_default"
};

describe("analytics reports over the MCP protocol", () => {
  let client: Client | undefined;
  let server: ReturnType<typeof createGlitchMcpServer> | undefined;

  afterEach(async () => {
    await client?.close();
    await server?.close();
  });

  it("sends a typed family query to the hosted facade and preserves partial report results", async () => {
    const mock = createFetchMock(() =>
      jsonResponse({
        data: {
          schema_version: "1.0",
          family: "sessions",
          summary: { requested: 2, succeeded: 1, failed: 1, partial: true },
          reports: [
            {
              key: "retention.d7",
              label: "Day 7 retention",
              ok: true,
              status: 200,
              empty: false,
              filters: { start_date: "2026-07-01", end_date: "2026-08-01", day: 7 },
              data: { retention_rate: 0.42 }
            },
            {
              key: "behavioral_funnels.report",
              label: "Behavioral funnel report",
              ok: false,
              status: 404,
              empty: true,
              filters: { funnel_id: "auto-observed-journey" },
              error: { code: "not_found", message: "No observed journey is available yet." }
            }
          ]
        }
      })
    );

    const glitch = new GlitchClient(config, mock.fetch);
    server = createGlitchMcpServer({ config, client: glitch });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "analytics-client", version: "0.0.0" });

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result: any = await client.callTool({
      name: "glitch_get_session_reports",
      arguments: {
        report_keys: ["retention.d7", "behavioral_funnels.report"],
        filters: { start_date: "2026-07-01", end_date: "2026-08-01" },
        report_filters: { "behavioral_funnels.report": { funnel_id: "auto-observed-journey" } }
      }
    });

    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0]?.url).toBe("https://mcp.example.test/mcp/v1/titles/title_default/analytics/query");
    expect(mock.requests[0]?.body).toEqual({
      family: "sessions",
      report_keys: ["retention.d7", "behavioral_funnels.report"],
      filters: { start_date: "2026-07-01", end_date: "2026-08-01" },
      report_filters: { "behavioral_funnels.report": { funnel_id: "auto-observed-journey" } },
      fail_fast: false
    });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent?.data?.summary).toMatchObject({ succeeded: 1, failed: 1, partial: true });
    expect(result.structuredContent?.data?.reports).toHaveLength(2);
    expect(result.content?.[0]?.text).toContain("1 succeeded, 1 unavailable");
    expect(result.content?.[0]?.text).toContain("No observed journey is available yet");
  });
});
