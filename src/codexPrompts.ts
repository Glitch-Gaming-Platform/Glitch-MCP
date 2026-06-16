import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export interface InstallCodexPromptsOptions {
  readonly codexHome?: string;
  readonly dryRun?: boolean;
}

export interface InstallCodexPromptsResult {
  readonly sourceDir: string;
  readonly targetDir: string;
  readonly files: string[];
  readonly dryRun: boolean;
}

export async function installCodexPrompts(options: InstallCodexPromptsOptions = {}): Promise<InstallCodexPromptsResult> {
  const sourceDir = fileURLToPath(new URL("../codex/prompts/", import.meta.url));
  const codexHome = options.codexHome || process.env.CODEX_HOME || join(homedir(), ".codex");
  const targetDir = join(codexHome, "prompts");
  const files = (await readdir(sourceDir)).filter((file) => /^glitch_[A-Za-z0-9_]+\.md$/.test(file)).sort();

  if (!options.dryRun) {
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
    dryRun: Boolean(options.dryRun)
  };
}

