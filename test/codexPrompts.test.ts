import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installCodexPrompts } from "../src/codexPrompts.js";

describe("installCodexPrompts", () => {
  let codexHome: string | undefined;

  afterEach(async () => {
    if (codexHome) {
      await rm(codexHome, { recursive: true, force: true });
      codexHome = undefined;
    }
  });

  it("copies packaged Glitch slash prompts into a Codex prompts directory", async () => {
    codexHome = await mkdtemp(join(tmpdir(), "glitch-codex-prompts-"));
    const result = await installCodexPrompts({ codexHome });

    expect(result.files).toContain("glitch_launch_audit.md");
    expect(result.files).toContain("glitch_open_dashboard.md");
    expect(result.files.length).toBeGreaterThanOrEqual(34);

    const prompt = await readFile(join(codexHome, "prompts", "glitch_launch_audit.md"), "utf8");
    expect(prompt).toContain("description: Run a Glitch launch readiness audit.");
  });
});

