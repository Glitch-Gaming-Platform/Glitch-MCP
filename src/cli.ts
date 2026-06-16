#!/usr/bin/env node
import { installClaudePrompts, installCodexPrompts, installCursorPrompts } from "./codexPrompts.js";
import { loadConfig } from "./config.js";
import { GlitchClient } from "./glitchClient.js";
import { runHttpServer, runStdioServer } from "./server.js";
import { GLITCH_MCP_VERSION } from "./version.js";

const USAGE = `Glitch MCP ${GLITCH_MCP_VERSION}

Usage:
  glitch-mcp [stdio]
  glitch-mcp http [--host 127.0.0.1] [--port 3333]
  glitch-mcp install-codex-prompts [--codex-home ~/.codex] [--dry-run]
  glitch-mcp install-cursor-prompts [--project-root .] [--target-dir .cursor/commands] [--dry-run]
  glitch-mcp install-claude-prompts [--project-root .] [--target-dir .claude/commands] [--dry-run]
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

  if (command === "install-codex-prompts" || command === "codex-prompts") {
    const codexHome = valueAfter(argv, "--codex-home");
    const result = await installCodexPrompts({
      ...(codexHome ? { codexHome } : {}),
      dryRun: argv.includes("--dry-run")
    });
    const action = result.dryRun ? "Would install" : "Installed";
    process.stdout.write(`${action} ${result.files.length} Glitch Codex prompts to ${result.targetDir}\n`);
    process.stdout.write(result.files.map((file) => `- /prompts:${file.replace(/\.md$/, "")}`).join("\n"));
    process.stdout.write("\n");
    return;
  }

  if (command === "install-cursor-prompts" || command === "cursor-prompts") {
    const result = await installCursorPrompts(promptInstallOptions(argv));
    printPromptInstallResult(result, "Cursor", "/");
    return;
  }

  if (command === "install-claude-prompts" || command === "claude-prompts") {
    const result = await installClaudePrompts(promptInstallOptions(argv));
    printPromptInstallResult(result, "Claude Code", "/");
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

function promptInstallOptions(argv: string[]) {
  const projectRoot = valueAfter(argv, "--project-root");
  const targetDir = valueAfter(argv, "--target-dir");
  return {
    ...(projectRoot ? { projectRoot } : {}),
    ...(targetDir ? { targetDir } : {}),
    dryRun: argv.includes("--dry-run")
  };
}

function printPromptInstallResult(result: Awaited<ReturnType<typeof installCodexPrompts>>, clientName: string, prefix: string): void {
  const action = result.dryRun ? "Would install" : "Installed";
  process.stdout.write(`${action} ${result.files.length} Glitch ${clientName} prompts to ${result.targetDir}\n`);
  process.stdout.write(result.files.map((file) => `- ${prefix}${file.replace(/\.md$/, "")}`).join("\n"));
  process.stdout.write("\n");
}

main(process.argv).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
