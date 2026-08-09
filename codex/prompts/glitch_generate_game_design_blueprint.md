---
description: Generate a game's mechanics and core loop.
argument-hint: [game idea]
---

Use Glitch MCP to generate a documentation-ready mechanics and core-loop blueprint.

Game idea or arguments I provided: $ARGUMENTS

Call `glitch_list_game_genres` first when exact genre names are unknown. Gather the game name, one or more genres, play mode, session length, player fantasy, setting, primary goal, main pressure, signature twist, and any optional progression or preferred activities. Then call `glitch_generate_game_design_blueprint`.

The call can take about a minute. Do not duplicate it while it is running. Return the complete result and save or update it using `documentationInstruction` when the game repository is available.
