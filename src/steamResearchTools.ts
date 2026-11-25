import * as z from "zod/v4";
import type { GlitchToolDefinition } from "./tools.js";
import type { GlitchClient } from "./glitchClient.js";
import { toolSuccess } from "./result.js";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");

const research = z.object({
  title_id: z.uuid().optional().describe("Game title UUID. Omit to use the MCP-selected title."),
  operation: z.enum(["capabilities", "comparables", "search", "game", "reports"])
    .describe("capabilities: operations, report keys and data notes. comparables: games similar to yours (or app_id) released around the same time, ranked with reviews, price and players, plus where your game ranks. search: find Steam games by name, genre, category, release window, price or review count. game: one game's details and daily player history. reports: named reports from the Glitch Steam report engine (competitive_set, pricing_fit_analysis, demand_proxy_score, marketing_message_angles and more)."),
  app_id: z.string().regex(/^\d{1,10}$/).optional()
    .describe("Steam app ID (the number in store.steampowered.com/app/<id>). For comparables/reports it replaces your game as the target; for game it picks the game. Omit to use the game's linked Steam app."),
  name: z.string().trim().min(2).max(200).optional().describe("Game name for operation=game when you do not know the app ID."),
  query: z.string().trim().min(2).max(200).optional().describe("Name search for operation=search."),
  genres: z.array(z.string().trim().min(2).max(80)).max(10).optional()
    .describe("Steam genres, e.g. Strategy, Action, RPG. search: games must have every genre. comparables: overrides the target's genres."),
  categories: z.array(z.string().trim().min(2).max(80)).max(10).optional()
    .describe("Steam features for search, e.g. Online Co-op, PvP, VR Supported. Games must have every one."),
  keywords: z.array(z.string().trim().min(2).max(60)).max(12).optional()
    .describe("comparables: theme words to weight heavily, e.g. alien, invasion, tripod, victorian."),
  released_from: date.optional().describe("Earliest Steam release date."),
  released_to: date.optional().describe("Latest Steam release date."),
  window_days: z.number().int().min(1).max(180).optional()
    .describe("comparables: days either side of the target's release date (default 14)."),
  history_days: z.number().int().min(1).max(180).optional().describe("game: days of daily player history (default 30)."),
  max_price: z.number().min(0).optional().describe("search: highest price in the collected currency."),
  min_reviews: z.number().int().min(0).optional().describe("search: minimum Steam review count."),
  sort: z.enum(["similarity", "peak_players", "current_players", "reviews", "positive_rate", "recommendations", "release_date"]).optional()
    .describe("comparables default similarity; search default peak_players (highest sampled players in the last 30 days)."),
  limit: z.number().int().min(1).max(50).optional().describe("Games to return (comparables default 15, search default 20)."),
  report_keys: z.array(z.string().trim().min(2).max(80)).min(1).max(8).optional()
    .describe("reports: keys from operation=capabilities."),
  peer_limit: z.number().int().min(1).max(100).optional().describe("reports: peer games to compare (default 25)."),
  include_adult: z.boolean().optional().describe("Include adult-content games (excluded by default)."),
}).strict();

type Row = Record<string, unknown>;

const num = (value: unknown): string => (typeof value === "number" ? value.toLocaleString("en-US") : "—");

function table(rows: Row[], extraHeader = "", extra: (row: Row) => string = () => ""): string {
  if (!rows.length) return "_No games matched._";
  const header = `| Game | Released | Reviews | Positive | Price | Peak players 30d | Now${extraHeader ? ` | ${extraHeader}` : ""} |`;
  const divider = `|---|---|---|---|---|---|---${extraHeader ? "|---" : ""}|`;
  const lines = rows.map((row) => {
    const price = typeof row.price === "number" ? `${row.price} ${row.currency ?? ""}`.trim() : "—";
    const positive = typeof row.positive_rate === "number" ? `${row.positive_rate}%` : "—";
    const cells = [
      `[${String(row.name ?? row.app_id)}](${String(row.store_url ?? "")})`,
      String(row.release_date ?? "—"),
      num(row.reviews),
      positive,
      price,
      num(row.peak_players_30d),
      num(row.current_players),
    ];
    if (extraHeader) cells.push(extra(row));
    return `| ${cells.join(" | ")} |`;
  });
  return [header, divider, ...lines].join("\n");
}

export function presentSteamResearch(operation: string, data: Row): string {
  const notes = Array.isArray(data.data_notes) ? `\n\n_${(data.data_notes as string[]).join(" ")}_` : "";
  if (operation === "comparables") {
    const target = (data.target ?? {}) as Row;
    const rank = (data.target_rank ?? {}) as Row;
    const window = (data.window ?? {}) as Row;
    const rows = (data.comparables ?? []) as Row[];
    const why = (row: Row) => {
      const similarity = (row.similarity ?? {}) as Row;
      return [...((similarity.shared_genres as string[]) ?? []), ...((similarity.shared_keywords as string[]) ?? [])].slice(0, 5).join(", ");
    };
    return [
      `**${String(target.name)}** vs ${num(data.similar_games_found)} similar games released ${String(window.released_from)} to ${String(window.released_to)}.`,
      rank.position ? `Your game ranks #${String(rank.position)} of ${String(rank.out_of)} by ${String(rank.by)}.` : `Your game has no ${String(rank.by ?? "player")} data yet.`,
      "",
      table(rows, "Shared", why),
    ].join("\n") + notes;
  }
  if (operation === "search") {
    return `${num(data.matches)}${data.matches_capped ? "+" : ""} games matched.\n\n${table((data.games ?? []) as Row[])}${notes}`;
  }
  if (operation === "game") {
    const game = (data.game ?? {}) as Row;
    const history = (data.player_history ?? []) as Row[];
    const recent = history.slice(-10).map((day) => `| ${String(day.date)} | ${num(day.peak_players)} | ${num(day.average_players)} |`);
    return [
      table([game]),
      "",
      history.length ? ["| Day | Peak | Average |", "|---|---|---|", ...recent].join("\n") : `_${String(data.player_tracking ?? "No player history.")}_`,
    ].join("\n") + notes;
  }
  if (operation === "reports") {
    const reports = (data.reports ?? {}) as Row;
    return `Generated ${Object.keys(reports).map((key) => `\`${key}\``).join(", ")}. Read the structured data for each report.${notes}`;
  }
  return `Operations: ${Object.keys((data.operations ?? {}) as Row).join(", ")}.${notes}`;
}

export const steamResearchToolDefinitions: GlitchToolDefinition[] = [
  {
    name: "glitch_research_steam_games",
    title: "Research Steam Games",
    description: "Research the Steam market from the catalog Glitch collects (300k+ Steam games with genres, features, prices, reviews and player counts sampled every few hours). Use comparables for a competitive set: games similar to yours released around your launch, with reviews, price and peak players, and where your game ranks. Use search to find games by name, genre, feature, release window, price or reviews; game for one game's details and daily player history; reports for deeper Steam report-engine analysis such as pricing fit, demand proxy and marketing angles. Read-only: needs reports:read, no Glitch Agent run or subscription, and never changes your game. Steam does not publish sales, so treat reviews, players and recommendations as demand signals.",
    inputSchema: research.shape,
    validationSchema: research,
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    handler: async (client: GlitchClient, input) => {
      const p = research.parse(input);
      if (p.operation === "reports" && !p.report_keys?.length) {
        throw new Error("operation=reports needs report_keys. Call operation=capabilities for the list.");
      }
      const { title_id, operation, ...body } = p;
      const titleId = client.resolveTitleId(title_id);
      const data = await client.steamResearch(titleId, operation, body);
      return toolSuccess({
        title: `Steam research: ${operation}`,
        summary: "Read-only Steam market research from the Glitch Steam catalog. Nothing was changed.",
        data,
        bodyMarkdown: presentSteamResearch(operation, data as Row),
      });
    },
  },
];
