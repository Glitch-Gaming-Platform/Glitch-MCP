import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface InstallCodexPromptsOptions {
  readonly codexHome?: string;
  readonly dryRun?: boolean;
}

export interface InstallClientPromptsOptions {
  readonly targetDir?: string;
  readonly projectRoot?: string;
  readonly dryRun?: boolean;
}

export interface InstallCodexPromptsResult {
  readonly sourceDir: string;
  readonly targetDir: string;
  readonly files: string[];
  readonly dryRun: boolean;
}

export async function installCodexPrompts(options: InstallCodexPromptsOptions = {}): Promise<InstallCodexPromptsResult> {
  const codexHome = options.codexHome || process.env.CODEX_HOME || join(homedir(), ".codex");
  const targetDir = join(codexHome, "prompts");
  return installPromptFiles(targetDir, options.dryRun);
}

export async function installCursorPrompts(options: InstallClientPromptsOptions = {}): Promise<InstallCodexPromptsResult> {
  const projectRoot = expandPath(options.projectRoot || process.cwd());
  const targetDir = options.targetDir ? expandPath(options.targetDir, projectRoot) : join(projectRoot, ".cursor", "commands");
  return installPromptFiles(targetDir, options.dryRun);
}

export async function installClaudePrompts(options: InstallClientPromptsOptions = {}): Promise<InstallCodexPromptsResult> {
  const projectRoot = expandPath(options.projectRoot || process.cwd());
  const targetDir = options.targetDir ? expandPath(options.targetDir, projectRoot) : join(projectRoot, ".claude", "commands");
  return installPromptFiles(targetDir, options.dryRun);
}

async function installPromptFiles(targetDir: string, dryRun = false): Promise<InstallCodexPromptsResult> {
  const sourceDir = fileURLToPath(new URL("../prompts/", import.meta.url));
  const files = (await readdir(sourceDir)).filter((file) => /^glitch_[A-Za-z0-9_]+\.md$/.test(file)).sort();

  if (!dryRun) {
    await mkdir(targetDir, { recursive: true });

    for (const file of files) {
      const content = await readFile(join(sourceDir, file), "utf8");
      await writeFile(join(targetDir, file), content, "utf8");
    }
  }

  return {
    sourceDir,
    targetDir,
    files,
    dryRun: Boolean(dryRun)
  };
}

function expandPath(path: string, baseDir = process.cwd()): string {
  const expanded = path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
  return isAbsolute(expanded) ? expanded : resolve(baseDir, expanded);
}
