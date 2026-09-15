import * as z from "zod/v4";
import { confirmationRequiredError, GlitchMcpError } from "./errors.js";
import type { JsonObject } from "./glitchClient.js";
import { toolSuccess } from "./result.js";
import type { GlitchToolDefinition } from "./tools.js";

const title = { title_id: z.string().trim().min(1).max(191).optional() };
const confirm = z.boolean().default(false).describe("Explicit user approval for this title-scoped write. Review existing definitions first.");
const key = z.string().trim().min(1).max(100);
const name = z.string().trim().min(1).max(255);
const number = z.number().finite();
const imageUrl = z.url().max(255).refine(value => /^https?:\/\//i.test(value), "Use an HTTP(S) image URL.").nullable().optional();

export const leaderboardDefinitionSchema = z.object({
  api_key: key,
  name,
  sort_order: z.enum(["asc", "desc"]),
  display_type: z.enum(["score", "time_ms", "distance", "currency", "percent"]),
  write_policy: z.enum(["client", "trusted_server"])
}).strict();

export const achievementDefinitionSchema = z.object({
  api_key: key,
  name,
  description: z.string().trim().min(1),
  is_hidden: z.boolean().optional(),
  progress_stat_id: z.uuid().nullable().optional().describe("A stat definition ID belonging to this title; use glitch_list_stat_definitions."),
  unlock_threshold: number.nullable().optional().describe("Must be positive when linked to a stat. Direct trophies unlock by api_key, not by this threshold."),
  tiered_data: z.record(z.string(), z.unknown()).nullable().optional().describe("Stored tier metadata; not a separate tier-award engine."),
  icon_locked_url: imageUrl,
  icon_unlocked_url: imageUrl
}).strict();

export const statDefinitionSchema = z.object({
  api_key: key,
  display_name: name,
  type: z.enum(["int", "float", "avgrate"]),
  aggregation_policy: z.enum(["sum", "max", "min", "latest"]),
  default_value: number.optional(),
  min_value: number.nullable().optional(),
  max_value: number.nullable().optional(),
  increment_only: z.boolean().optional(),
  max_delta: number.nullable().optional()
}).strict();

export const progressionSeasonSchema = z.object({
  name,
  start_date: z.iso.datetime({ offset: true }),
  end_date: z.iso.datetime({ offset: true }),
  is_active: z.boolean().optional()
}).strict();

type Resource = "leaderboards" | "achievements" | "stats" | "seasons";

function definitionWrite(
  toolName: string, resource: Resource, idField: string, schema: z.ZodObject,
  action: "create" | "update" | "delete", description: string
): GlitchToolDefinition {
  const input = z.object({
    ...title,
    ...(action === "create" ? schema.shape : action === "update" ? schema.partial().shape : {}),
    ...(action === "create" ? {} : { [idField]: z.uuid() }),
    confirm
  }).strict();
  return {
    name: toolName, title: `${action} ${resource}`, description: `${description} Requires progression:write and confirm=true. Omitted update fields remain unchanged. Never put developer MCP credentials in shipped games.`,
    inputSchema: input.shape, validationSchema: input,
    readOnlyHint: false, destructiveHint: action !== "create", idempotentHint: action === "update",
    handler: async (client, raw) => {
      const parsed = input.parse(raw) as JsonObject;
      if (!parsed.confirm) throw confirmationRequiredError(`${action} ${resource}`);
      const { title_id, confirm: approved, [idField]: id, ...fields } = parsed;
      if (action === "update" && Object.keys(fields).length === 0) {
        throw new GlitchMcpError("validation_error", "Provide at least one definition field to update.");
      }
      if (resource === "achievements" && fields.progress_stat_id && action === "create"
        && !(typeof fields.unlock_threshold === "number" && fields.unlock_threshold > 0)) {
        throw new GlitchMcpError("validation_error", "A progressive achievement requires a positive unlock_threshold.");
      }
      if (resource === "seasons" && typeof fields.start_date === "string" && typeof fields.end_date === "string"
        && Date.parse(fields.end_date) <= Date.parse(fields.start_date)) {
        throw new GlitchMcpError("validation_error", "end_date must be after start_date.");
      }
      const data = await client.writeProgressionDefinition(client.resolveTitleId(title_id as string | undefined), resource, action,
        { ...fields, confirm: approved }, id as string | undefined);
      return toolSuccess({ title: `${resource}: ${action}`, summary: "The server applied the reviewed definition change. Existing run history is not recalculated by definition edits.", data });
    }
  };
}

function readTool(name: string, label: string, description: string, schema: z.ZodObject,
  handler: (client: Parameters<GlitchToolDefinition["handler"]>[0], args: JsonObject) => Promise<JsonObject>): GlitchToolDefinition {
  return { name, title: label, description, inputSchema: schema.shape, validationSchema: schema,
    readOnlyHint: true, destructiveHint: false, idempotentHint: true,
    handler: async (client, input) => toolSuccess({ title: label, summary: description, data: await handler(client, schema.parse(input)) }) };
}

export const progressionToolDefinitions: GlitchToolDefinition[] = [
  definitionWrite("glitch_create_leaderboard", "leaderboards", "leaderboard_id", leaderboardDefinitionSchema, "create", "Create a board with an exact machine api_key, display format, sort order and write policy."),
  definitionWrite("glitch_update_leaderboard", "leaderboards", "leaderboard_id", leaderboardDefinitionSchema, "update", "Edit a board by definition ID. Changing sort order after any score was recorded is rejected; create a new board instead."),
  definitionWrite("glitch_delete_leaderboard", "leaderboards", "leaderboard_id", leaderboardDefinitionSchema, "delete", "Permanently delete a board and its entries. Review the definition ID and warn about score loss first."),
  definitionWrite("glitch_create_achievement", "achievements", "achievement_id", achievementDefinitionSchema, "create", "Create a trophy with hidden status, locked/unlocked icon URLs, optional same-title stat link and threshold. Upload icons with glitch_upload_achievement_icon."),
  definitionWrite("glitch_update_achievement", "achievements", "achievement_id", achievementDefinitionSchema, "update", "Edit a trophy by ID, including icons/visibility and stat linkage. Null clears optional fields. Existing unlocks are not revoked or retroactively recomputed."),
  definitionWrite("glitch_delete_achievement", "achievements", "achievement_id", achievementDefinitionSchema, "delete", "Permanently delete a trophy and its player unlock/progress states. Review the ID and warn about lost unlocks first."),
  readTool("glitch_list_stat_definitions", "List Stat Definitions", "List this title's stat keys, IDs, aggregation, bounds and anti-cheat limits. Requires progression:read.", z.object(title).strict(),
    (client, args) => client.listProgressionDefinitions(client.resolveTitleId(args.title_id as string | undefined), "stats")),
  definitionWrite("glitch_create_stat_definition", "stats", "stat_id", statDefinitionSchema, "create", "Create a tracked stat before linking progressive achievements to its returned ID."),
  definitionWrite("glitch_update_stat_definition", "stats", "stat_id", statDefinitionSchema, "update", "Edit a stat's fields and aggregation/bounds. Changes apply to future submissions; historical player values are not rewritten."),
  definitionWrite("glitch_delete_stat_definition", "stats", "stat_id", statDefinitionSchema, "delete", "Delete a stat and player values. Rejected while achievements reference it; explicitly unlink/delete those first."),
  readTool("glitch_list_progression_seasons", "List Progression Seasons", "List season IDs, time windows and active status. Requires progression:read.", z.object(title).strict(),
    (client, args) => client.listProgressionDefinitions(client.resolveTitleId(args.title_id as string | undefined), "seasons")),
  definitionWrite("glitch_create_progression_season", "seasons", "season_id", progressionSeasonSchema, "create", "Create a season time window using ISO 8601 dates. Active seasons are assigned by server time; avoid overlapping active windows."),
  definitionWrite("glitch_update_progression_season", "seasons", "season_id", progressionSeasonSchema, "update", "Edit season name, window or active flag. Existing runs are not moved between seasons."),
  definitionWrite("glitch_delete_progression_season", "seasons", "season_id", progressionSeasonSchema, "delete", "Soft-delete a season to stop automatic assignment, retaining its historical scores and stats."),
  readTool("glitch_list_player_stats", "List Player Stats", "Read stats for a known player install. Requires progression:read; guest installs do not support progression.", z.object({ ...title, install_id: z.string().min(1).max(191) }).strict(),
    (client, args) => client.listPlayerStats(client.resolveTitleId(args.title_id as string | undefined), args.install_id as string)),
  {
    name: "glitch_create_progression_test_install", title: "Create Developer Progression Test Install",
    description: "Create/reuse the authenticated developer's own test install, never another player's identity. Requires progression:submit and confirm=true. Submissions affect this account's real progression for the selected title; this is not an isolated sandbox.",
    inputSchema: { ...title, confirm }, validationSchema: z.object({ ...title, confirm }).strict(),
    readOnlyHint: false, destructiveHint: false, idempotentHint: false,
    handler: async (client, raw) => {
      const args = z.object({ ...title, confirm }).strict().parse(raw);
      if (!args.confirm) throw confirmationRequiredError("create developer test install");
      return toolSuccess({ title: "Developer test install", summary: "Use the returned install ID for explicitly approved test submissions. They affect your real progression.",
        data: await client.createProgressionTestInstall(client.resolveTitleId(args.title_id)) });
    }
  }
];
