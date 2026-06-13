import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GLITCH_MCP_VERSION } from "../src/version.js";

describe("GLITCH_MCP_VERSION", () => {
  it("matches the version declared in package.json", () => {
    const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version: string };

    expect(GLITCH_MCP_VERSION).toBe(pkg.version);
  });
});
