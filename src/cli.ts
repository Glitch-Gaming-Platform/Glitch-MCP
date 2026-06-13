#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { GlitchClient } from "./glitchClient.js";
import { runHttpServer, runStdioServer } from "./server.js";
import { GLITCH_MCP_VERSION } from "./version.js";

const USAGE = `Glitch MCP ${GLITCH_MCP_VERSION}

Usage:
  glitch-mcp [stdio]
  glitch-mcp http [--host 127.0.0.1] [--port 3333]
  glitch-mcp doctor
  glitch-mcp version

Environment:
  GLITCH_API_BASE_URL         Hosted Glitch API MCP facade. Default: https://api.glitch.fun/api
  GLITCH_API_TOKEN            Title-scoped MCP token from Glitch.
  GLITCH_TITLE_ID             Optional default title id for title-scoped tools.
  GLITCH_DASHBOARD_URL        Human dashboard base URL. Default: https://app.glitch.fun
  GLITCH_MCP_TIMEOUT_MS       Hosted API timeout in milliseconds. Default: 30000
  GLITCH_MCP_UPLOAD_ALLOWED_ROOTS
                              Optional comma-separated roots for local file uploads
`;

async function main(argv: string[]): Promise<void> {
  const command = argv[2] || "stdio";

  if (command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(USAGE);
    return;
  }

  if (command === "version" || command === "--version" || command === "-v") {
    process.stdout.write(`${GLITCH_MCP_VERSION}\n`);
    return;
  }

  const config = loadConfig();

  if (command === "doctor") {
    await runDoctor(config);
    return;
  }

  if (command === "http") {
    const host = valueAfter(argv, "--host") || "127.0.0.1";
    const port = Number.parseInt(valueAfter(argv, "--port") || "3333", 10);
    if (!Number.isFinite(port) || port <= 0) {
      throw new Error("--port must be a positive integer.");
    }

    await runHttpServer({ config, host, port });
    process.stderr.write(`Glitch MCP HTTP server listening on http://${host}:${port}/mcp\n`);
    return;
  }

  if (command !== "stdio") {
    throw new Error(`Unknown command: ${command}\n\n${USAGE}`);
  }

  await runStdioServer(config);
}

async function runDoctor(config: ReturnType<typeof loadConfig>): Promise<void> {
  const client = new GlitchClient(config);
  const status = await client.authStatus(config.defaultTitleId);
  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        apiBaseUrl: config.apiBaseUrl,
        dashboardBaseUrl: config.dashboardBaseUrl,
        hasToken: Boolean(config.token),
        defaultTitleId: config.defaultTitleId || null,
        status
      },
      null,
      2
    )
  );
  process.stdout.write("\n");
}

function valueAfter(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }

  return argv[index + 1];
}

main(process.argv).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
