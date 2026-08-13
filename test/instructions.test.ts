import { describe, expect, it } from "vitest";
import { GLITCH_SERVER_INSTRUCTIONS } from "../src/instructions.js";

describe("Glitch MCP server instructions", () => {
  it("requires real cross-origin game activity relays without passive fake activity", () => {
    expect(GLITCH_SERVER_INSTRUCTIONS).toContain("aegis_user_activity");
    expect(GLITCH_SERVER_INSTRUCTIONS).toContain("verified Glitch parent origin");
    expect(GLITCH_SERVER_INSTRUCTIONS).toContain("never substitute timers, focus, animation frames, passive telemetry, or network heartbeats");
    expect(GLITCH_SERVER_INSTRUCTIONS).toContain("remains open beyond five minutes without reloading");
  });
});
