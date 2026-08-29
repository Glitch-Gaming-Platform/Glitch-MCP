import { describe, expect, it } from "vitest";
import { GLITCH_SERVER_INSTRUCTIONS } from "../src/instructions.js";

describe("Glitch MCP server instructions", () => {
  it("requires real cross-origin game activity relays without passive fake activity", () => {
    expect(GLITCH_SERVER_INSTRUCTIONS).toContain("aegis_user_activity");
    expect(GLITCH_SERVER_INSTRUCTIONS).toContain("verified Glitch parent origin");
    expect(GLITCH_SERVER_INSTRUCTIONS).toContain("never substitute timers, focus, animation frames, passive telemetry, or network heartbeats");
    expect(GLITCH_SERVER_INSTRUCTIONS).toContain("remains open beyond five minutes without reloading");
  });

  it("requires resumable build polling and an explicit Node Docker port contract", () => {
    expect(GLITCH_SERVER_INSTRUCTIONS).toContain("resume polling that same id");
    expect(GLITCH_SERVER_INSTRUCTIONS).toContain("HTTP 400");
    expect(GLITCH_SERVER_INSTRUCTIONS).toContain("production Dockerfile in the same build context");
    expect(GLITCH_SERVER_INSTRUCTIONS).toContain("HOST=0.0.0.0");
    expect(GLITCH_SERVER_INSTRUCTIONS).toContain("target_port=3000");
  });

  it("documents automatic and developer-owned Aegis bridge deployment paths", () => {
    expect(GLITCH_SERVER_INSTRUCTIONS).toContain("https://api.glitch.fun/js/aegis-bridge.js");
    expect(GLITCH_SERVER_INSTRUCTIONS).toContain("static HTML/HTM entries");
    expect(GLITCH_SERVER_INSTRUCTIONS).toContain("Normal Node/SSR entries, streamed-native/noVNC frontends, generic container images");
    expect(GLITCH_SERVER_INSTRUCTIONS).toContain("custom Pixel Streaming frontends");
  });
});
