import { describe, expect, it } from "vitest";
import {
  GAME_DEVELOPMENT_PROMPTS,
  filterGameDevelopmentPrompts,
  gameDesignGenreProfile,
  gameDevelopmentPromptCommandName,
  gameDevelopmentPromptResourceUri,
  gameDevelopmentPromptUrl,
  getGameDevelopmentPrompt
} from "../src/gameDevelopmentPrompts.js";

describe("public AI game-development prompts", () => {
  it("bundles the authoritative 25-prompt catalog with documentation requirements", () => {
    expect(GAME_DEVELOPMENT_PROMPTS).toHaveLength(25);
    expect(new Set(GAME_DEVELOPMENT_PROMPTS.map((prompt) => prompt.id)).size).toBe(25);

    for (const prompt of GAME_DEVELOPMENT_PROMPTS) {
      expect(prompt.prompt).toMatch(/^# Task:/);
      expect(prompt.prompt).toContain("## Required game documentation");
      expect(prompt.prompt).toContain("## Player-readable output requirement");
      expect(prompt.prompt).toContain("Never expose raw exceptions, stack traces, JSON");
      expect(prompt.prompt).toContain("what the player can do next");
      expect(prompt.prompt).toContain("In the final report, list every documentation file created or updated.");
      expect(gameDevelopmentPromptCommandName(prompt.id)).toMatch(/^glitch_game_dev_[a-z0-9_]+$/);
      expect(gameDevelopmentPromptResourceUri(prompt.id)).toBe(`glitch://game-development/prompts/${prompt.id}`);
      expect(gameDevelopmentPromptUrl(prompt.id)).toContain(`?prompt=${prompt.id}#prompt-picker`);
    }
  });

  it("supports stable lookup, category filtering, and situation search", () => {
    expect(getGameDevelopmentPrompt("build-playable-vertical-slice")?.title).toBe("Implement the first playable build");
    expect(getGameDevelopmentPrompt("game-onboarding-flow")?.prompt).toContain("Do not stop after writing the specification.");
    expect(getGameDevelopmentPrompt("production-game-analytics")?.prompt).toContain(
      "Glitch Analytics dashboard and setup: https://www.glitch.fun/publishers/analytics"
    );
    expect(getGameDevelopmentPrompt("production-game-analytics")?.prompt).toContain("## Establish tracking before gameplay implementation");
    expect(getGameDevelopmentPrompt("production-game-analytics")?.prompt).toContain("maps every important player journey and game system");
    expect(getGameDevelopmentPrompt("threejs-game-architecture")?.prompt).toContain("## Movement and animation audit");
    expect(getGameDevelopmentPrompt("threejs-game-architecture")?.prompt).toContain("## Collision and hit-detection audit");
    expect(getGameDevelopmentPrompt("threejs-game-architecture")?.prompt).toContain("Resolve physics and collision before visual animation and rendering");
    expect(getGameDevelopmentPrompt("threejs-game-architecture")?.prompt).toContain("## Game UI, menu, HUD, and button design audit");
    expect(getGameDevelopmentPrompt("threejs-game-architecture")?.prompt).toContain("rather than a website, admin dashboard, launcher");
    expect(getGameDevelopmentPrompt("threejs-game-architecture")?.prompt).toContain("## Internationalization and localization architecture");
    expect(getGameDevelopmentPrompt("threejs-game-architecture")?.prompt).toContain("Do not hard-code display strings");
    expect(getGameDevelopmentPrompt("visual-quality-rubric")?.prompt).toContain("overall AAA visual-readiness score");
    expect(getGameDevelopmentPrompt("visual-quality-rubric")?.prompt).toContain("Every applicable control must define idle, hover");
    expect(getGameDevelopmentPrompt("visual-quality-rubric")?.prompt).toContain("## Representative visual states and complete-frame communication audit");
    expect(getGameDevelopmentPrompt("visual-quality-rubric")?.prompt).toContain("tactile presentation of cards, tiles, tokens, units");
    expect(getGameDevelopmentPrompt("visual-quality-rubric")?.prompt).toContain("Use a one-second readability check");
    expect(getGameDevelopmentPrompt("optimized-asset-pipeline")?.prompt).toContain("root motion or in-place movement");
    expect(getGameDevelopmentPrompt("optimized-asset-pipeline")?.prompt).toContain("Do not automatically reuse detailed render meshes or animated bones as colliders");
    expect(getGameDevelopmentPrompt("optimized-asset-pipeline")?.prompt).toContain("## Game UI asset pipeline");
    expect(getGameDevelopmentPrompt("build-playable-vertical-slice")?.prompt).toContain("placeholder clips or sliding transforms");
    expect(getGameDevelopmentPrompt("build-playable-vertical-slice")?.prompt).toContain("## Collision and hit-detection implementation");
    expect(getGameDevelopmentPrompt("build-playable-vertical-slice")?.prompt).toContain("## Game UI, menu, HUD, and button implementation");
    expect(getGameDevelopmentPrompt("build-playable-vertical-slice")?.prompt).toContain("## Internationalization and localization implementation");
    expect(getGameDevelopmentPrompt("build-playable-vertical-slice")?.prompt).toContain("Run pseudolocalization and representative real-locale tests");
    expect(getGameDevelopmentPrompt("build-playable-vertical-slice")?.prompt).toContain("## Analytics implementation requirement");
    expect(getGameDevelopmentPrompt("game-onboarding-flow")?.prompt).toContain("event-timed hitboxes");
    expect(getGameDevelopmentPrompt("game-onboarding-flow")?.prompt).toContain("predictable controller or keyboard focus with no dead ends");
    expect(getGameDevelopmentPrompt("build-game-from-approved-plans")?.prompt).toContain("prevent repeated hits");
    expect(getGameDevelopmentPrompt("mobile-game-optimization")?.prompt).toContain("safe areas, localization expansion, text scaling");
    expect(getGameDevelopmentPrompt("mobile-game-optimization")?.prompt).toContain("## Protect the desktop experience");
    expect(getGameDevelopmentPrompt("mobile-game-optimization")?.prompt).toContain("must not reduce or unintentionally change the existing desktop experience");
    expect(getGameDevelopmentPrompt("mobile-game-optimization")?.prompt).toContain("show no unapproved regression");
    expect(getGameDevelopmentPrompt("final-aaa-visual-optimization")?.warning).toContain("consume a large number of AI tokens");
    expect(getGameDevelopmentPrompt("final-aaa-visual-optimization")?.prompt).toContain("## Low and Ultra graphics implementations");
    expect(getGameDevelopmentPrompt("final-aaa-visual-optimization")?.prompt).toContain("labels and file ordering hidden");
    expect(getGameDevelopmentPrompt("audit-game-media-pipeline")?.prompt).toContain("## Map the sound effects the game needs");
    expect(getGameDevelopmentPrompt("audit-game-media-pipeline")?.prompt).toContain("## Map the music loops the game needs");
    expect(GAME_DEVELOPMENT_PROMPTS.findIndex((prompt) => prompt.id === "game-onboarding-flow")).toBe(
      GAME_DEVELOPMENT_PROMPTS.findIndex((prompt) => prompt.id === "build-playable-vertical-slice") + 1
    );
    expect(GAME_DEVELOPMENT_PROMPTS.findIndex((prompt) => prompt.id === "production-game-analytics")).toBe(
      GAME_DEVELOPMENT_PROMPTS.findIndex((prompt) => prompt.id === "build-playable-vertical-slice") - 1
    );
    expect(GAME_DEVELOPMENT_PROMPTS.findIndex((prompt) => prompt.id === "final-aaa-visual-optimization")).toBe(
      GAME_DEVELOPMENT_PROMPTS.findIndex((prompt) => prompt.id === "mobile-game-optimization") + 1
    );
    expect(filterGameDevelopmentPrompts({ category: "media" })).toHaveLength(7);
    expect(filterGameDevelopmentPrompts({ search: "mobile" }).map((prompt) => prompt.id)).toEqual(
      expect.arrayContaining(["mobile-game-optimization", "mobile-media-optimization"])
    );
  });

  it("maps live genre names to the backend's deterministic fallback profiles", () => {
    expect(gameDesignGenreProfile("Role-playing (RPG)")).toBe("rpg");
    expect(gameDesignGenreProfile("Turn-Based Strategy")).toBe("strategy");
    expect(gameDesignGenreProfile("Deckbuilder")).toBe("card");
    expect(gameDesignGenreProfile("Metroidvania")).toBe("platformer");
    expect(gameDesignGenreProfile("Experimental Rhythm")).toBe("action");
  });
});
