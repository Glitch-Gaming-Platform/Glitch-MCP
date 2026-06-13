import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { createGlitchMcpServer } from "../src/server.js";

const config = {
  apiBaseUrl: "https://mcp.example.test",
  dashboardBaseUrl: "https://app.example.test",
  timeoutMs: 1000,
  clientName: "test-client",
  defaultTitleId: "title_default"
};

describe("createGlitchMcpServer", () => {
  let client: Client | undefined;
  let server: ReturnType<typeof createGlitchMcpServer> | undefined;

  afterEach(async () => {
    await client?.close();
    await server?.close();
  });

  it("initializes over MCP and lists tools, prompts, and resources", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "0.0.0" });
    server = createGlitchMcpServer({ config });

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain("glitch_start_agent_run");
    expect(tools.tools.map((tool) => tool.name)).toContain("glitch_execute_action");

    const prompts = await client.listPrompts();
    expect(prompts.prompts.map((prompt) => prompt.name)).toContain("glitch_launch_audit");

    const resource = await client.readResource({ uri: "glitch://mcp/capabilities" });
    expect(resource.contents[0]?.mimeType).toBe("application/json");
    expect(resource.contents[0]).toHaveProperty("text");

    const widget = await client.readResource({ uri: "ui://glitch/run-status.html" });
    expect(widget.contents[0]?.mimeType).toBe("text/html");
    expect("text" in widget.contents[0]!).toBe(true);
  });
});
