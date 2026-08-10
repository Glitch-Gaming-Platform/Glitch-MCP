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
  it("bundles the authoritative 24-prompt catalog with documentation requirements", () => {
    expect(GAME_DEVELOPMENT_PROMPTS).toHaveLength(24);
    expect(new Set(GAME_DEVELOPMENT_PROMPTS.map((prompt) => prompt.id)).size).toBe(24);

    for (const prompt of GAME_DEVELOPMENT_PROMPTS) {
      expect(prompt.prompt).toMatch(/^# Task:/);
      expect(prompt.prompt).toContain("## Required game documentation");
      expect(prompt.prompt).toContain("In the final report, list every documentation file created or updated.");
      expect(gameDevelopmentPromptCommandName(prompt.id)).toMatch(/^glitch_game_dev_[a-z0-9_]+$/);
      expect(gameDevelopmentPromptResourceUri(prompt.id)).toBe(`glitch://game-development/prompts/${prompt.id}`);
      expect(gameDevelopmentPromptUrl(prompt.id)).toContain(`?prompt=${prompt.id}#prompt-picker`);
    }
  });

  it("supports stable lookup, category filtering, and situation search", () => {
    expect(getGameDevelopmentPrompt("build-playable-vertical-slice")?.title).toBe("Implement the first playable build");
    expect(getGameDevelopmentPrompt("game-onboarding-flow")?.prompt).toContain("Do not stop after writing the specification.");
    expect(GAME_DEVELOPMENT_PROMPTS.findIndex((prompt) => prompt.id === "game-onboarding-flow")).toBe(
      GAME_DEVELOPMENT_PROMPTS.findIndex((prompt) => prompt.id === "build-playable-vertical-slice") + 1
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
