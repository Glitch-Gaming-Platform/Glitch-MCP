import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
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

describe("guidance elicitation over the MCP protocol", () => {
  let client: Client | undefined;
  let server: ReturnType<typeof createGlitchMcpServer> | undefined;

  afterEach(async () => {
    await client?.close();
    await server?.close();
  });

  it("prompts an elicitation-capable client and routes the choice back to the agent", async () => {
    const mock = createFetchMock((request) => {
      if ((request.init?.method ?? "GET") === "GET") {
        return jsonResponse({
          data: {
            items: [
              {
                id: "guid_1",
                status: "open",
                question: "Which platform should we prioritize?",
                options: [
                  { value: "steam", label: "Steam" },
                  { value: "switch", label: "Nintendo Switch" }
                ],
                recommended_option: "steam"
              }
            ]
          }
        });
      }
      return jsonResponse({ data: { id: "guid_1", status: "answered" } });
    });

    const glitch = new GlitchClient(config, mock.fetch);
    server = createGlitchMcpServer({ config, client: glitch });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "elicit-client", version: "0.0.0" }, { capabilities: { elicitation: {} } });

    // The client renders the agent's stop gate and picks an option.
    let promptMessage = "";
    client.setRequestHandler(ElicitRequestSchema, async (request) => {
      promptMessage = request.params.message;
      return { action: "accept", content: { answer: "switch" } };
    });

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result: any = await client.callTool({ name: "glitch_resolve_guidance", arguments: {} });

    expect(promptMessage).toContain("Which platform");
    const post = mock.requests.find((r) => (r.init?.method ?? "GET") === "POST");
    expect(post?.url).toBe("https://mcp.example.test/mcp/v1/titles/title_default/guidance/guid_1/answer");
    expect(post?.body).toMatchObject({ answer: "Nintendo Switch", selected_option: "switch" });
    expect(result.structuredContent?.data?.interactive).toBe(true);
  });
});
