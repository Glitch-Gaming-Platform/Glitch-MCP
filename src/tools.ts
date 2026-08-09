import { open, readFile, realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";
import { GlitchMcpError, confirmationRequiredError } from "./errors.js";
import { GlitchClient, JsonObject } from "./glitchClient.js";
import { buildGameDesignBlueprint } from "./gameDesignBlueprint.js";
import {
  GAME_DEVELOPMENT_PROMPT_CATEGORIES,
  filterGameDevelopmentPrompts,
  gameDesignGenreProfile,
  gameDevelopmentPromptResourceUri,
  gameDevelopmentPromptUrl,
  getGameDevelopmentPrompt
} from "./gameDevelopmentPrompts.js";
import {
  DEFAULT_SOCIAL_ASSET_FOLDERS,
  assertLocalPathAllowed,
  hashLocalAssetFile,
  mimeTypeForSocialAsset,
  readSocialAssetManifest,
  scanSocialAssetFolders,
  setupSocialAssetFolders,
  startSocialAssetWatch,
  stopSocialAssetWatch,
  type SocialAssetCandidate
} from "./localAssets.js";
import {
  presentActions,
  presentAnalytics,
  presentArtifacts,
  presentBilling,
  presentFinalReport,
  presentGuidance,
  presentRun,
  presentTitles
} from "./present.js";
import { safeTool, toolSuccess } from "./result.js";

/** Maximum upload size (50 MB), matching the hosted facade's limit. */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_UPLOAD_BASE64_CHARS = Math.ceil((MAX_UPLOAD_BYTES * 4) / 3) + 4;

/**
 * Extension -> mime map for the file types the hosted facade accepts.
 *
 * Used to infer mime_type when a client does not provide one. The hosted facade
 * re-validates the allowed type, so an unknown extension is rejected server-side.
 */
const UPLOAD_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  webm: "video/webm",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
};

function inferMimeType(fileName: string, provided?: string): string {
  if (provided && provided.trim()) {
    return provided.trim();
  }
  const ext = extname(fileName).replace(/^\./, "").toLowerCase();
  const mime = UPLOAD_MIME_BY_EXTENSION[ext];
  if (!mime) {
    throw new GlitchMcpError(
      "validation_error",
      `Could not infer a mime type for "${fileName}". Pass mime_type, or use one of these extensions: ${Object.keys(UPLOAD_MIME_BY_EXTENSION).join(", ")}.`
    );
  }
  return mime;
}

type RawShape = z.core.$ZodShape;

/**
 * Per-call runtime context exposed to tool handlers.
 *
 * Lets long-running tools stream live progress and log lines back to the client
 * (a richer experience in Codex/Cursor/Claude Code) and observe cancellation.
 * All emitters are best-effort no-ops when the client did not request them.
 */
/** A single field requested in an elicitation prompt. */
export interface ElicitProperty {
  readonly type: "string";
  readonly title?: string;
  readonly description?: string;
  readonly enum?: string[];
  readonly enumNames?: string[];
  readonly default?: string;
}

export interface ElicitSchema {
  readonly type: "object";
  readonly properties: Record<string, ElicitProperty>;
  readonly required?: string[];
}

export interface ElicitOutcome {
  /** "unsupported" means the client cannot show prompts; callers should fall back. */
  readonly action: "accept" | "decline" | "cancel" | "unsupported";
  readonly content?: Record<string, unknown>;
}

export interface ToolRuntimeContext {
  readonly signal?: AbortSignal;
  /** True when the client can receive progress/log notifications. */
  readonly streamingEnabled: boolean;
  /** True when the client declared the MCP elicitation capability (interactive prompts). */
  readonly canElicit: boolean;
  log(level: "debug" | "info" | "warning" | "error", message: string): Promise<void>;
  progress(progress: number, total: number | undefined, message?: string): Promise<void>;
  /** Ask the user a structured question (multiple choice / free text). */
  elicit(request: { message: string; requestedSchema: ElicitSchema }): Promise<ElicitOutcome>;
}

export interface GlitchToolDefinition {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: RawShape;
  readonly readOnlyHint?: boolean;
  readonly destructiveHint?: boolean;
  readonly idempotentHint?: boolean;
  readonly uiResourceUri?: string;
  readonly handler: (client: GlitchClient, input: Record<string, unknown>, ctx?: ToolRuntimeContext) => Promise<CallToolResult>;
}

const idSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9_.:-]+$/, "Use a Glitch id, UUID, slug, or title key without spaces.");

const titleIdSchema = idSchema.describe("Glitch game title id. Omit only after calling glitch_select_title or setting GLITCH_TITLE_ID.");
const runIdSchema = idSchema.describe("Glitch agent run id.");
const actionIdSchema = idSchema.describe("Glitch agent action id.");
const guidanceIdSchema = idSchema.describe("Glitch guidance request id.");

const optionalTitleShape = {
  title_id: titleIdSchema.optional()
};

const authStatusInput = z.object({
  ...optionalTitleShape
});

const listTitlesInput = z.object({
  include_archived: z.boolean().default(false).describe("Include archived titles when the token has permission.")
});

const selectTitleInput = z.object({
  title_id: titleIdSchema
});

const titleContextInput = z.object({
  ...optionalTitleShape
});

const gameDevelopmentPromptCategorySchema = z.enum(["all", "foundation", "visuals", "media", "feedback", "launch"]);

const listGameDevelopmentPromptsInput = z.object({
  category: gameDevelopmentPromptCategorySchema.default("all").describe("Optional prompt-library category filter."),
  search: z.string().trim().max(200).optional().describe("Optional search across prompt ids, titles, descriptions, and use cases.")
});

const getGameDevelopmentPromptInput = z.object({
  prompt_id: z.string().trim().min(1).max(120).regex(/^[a-z0-9-]+$/).describe("Stable prompt id returned by glitch_list_game_development_prompts.")
});

const listGameGenresInput = z.object({});

const generateGameDesignBlueprintInput = z.object({
  game_name: z.string().trim().max(120).optional(),
  genres: z.array(z.string().trim().min(1).max(80)).min(1).max(8).describe("One to eight exact genre names from glitch_list_game_genres."),
  play_mode: z.enum(["single-player", "cooperative", "competitive multiplayer", "asynchronous multiplayer"]),
  session_length: z.enum(["5–10 minute", "15–30 minute", "30–60 minute", "open-ended"]),
  player_fantasy: z.string().trim().min(10).max(700).describe("Who the player feels like and what fantasy the game delivers."),
  setting: z.string().trim().min(5).max(700),
  primary_goal: z.string().trim().min(5).max(700),
  main_pressure: z.string().trim().min(5).max(700).describe("The force, scarcity, opponent, or clock that makes decisions difficult."),
  signature_twist: z.string().trim().min(5).max(700).describe("The rule or interaction that makes the game distinct."),
  progression: z.string().trim().max(700).optional(),
  preferred_activities: z.string().trim().max(700).optional().describe("Optional verbs or activities the player should repeatedly perform.")
});

const analyticsFilterScalar = z.union([z.string().max(500), z.number(), z.boolean(), z.null()]);
const analyticsFilterValue = z.union([analyticsFilterScalar, z.array(analyticsFilterScalar).max(100)]);
const analyticsFiltersSchema = z.record(z.string().max(120), analyticsFilterValue);
const analyticsFamilySchema = z.enum(["sessions", "web", "storefront", "wishlist", "earnings", "attribution", "cross_device"]);

const analyticsCapabilitiesInput = z.object({
  ...optionalTitleShape
});

const analyticsReportInput = z.object({
  ...optionalTitleShape,
  report_key: z.string().trim().min(1).max(120).regex(/^[a-z0-9_.-]+$/),
  filters: analyticsFiltersSchema.default({}).describe("Report filters from glitch_get_analytics_capabilities."),
  fail_fast: z.boolean().default(false)
});

const analyticsFamilyInput = z.object({
  ...optionalTitleShape,
  report_keys: z.array(z.string().trim().min(1).max(120)).max(25).optional().describe("Optional subset from the selected family's report catalog."),
  filters: analyticsFiltersSchema.default({}).describe("Common filters applied where supported, such as dates, platform, device, country, UTM, campaign, or scheduler."),
  report_filters: z.record(z.string().max(120), analyticsFiltersSchema).default({}).describe("Per-report filter overrides keyed by report key."),
  fail_fast: z.boolean().default(false).describe("Stop after the first unavailable report instead of returning partial results.")
});

const billingInput = z.object({
  ...optionalTitleShape
});

const socialCapabilitiesInput = z.object({
  ...optionalTitleShape
});

const socialOperationInput = z.object({
  ...optionalTitleShape,
  operation: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .regex(/^[A-Za-z0-9._-]+$/, "Use an operation name returned by glitch_get_social_capabilities."),
  arguments: z
    .record(z.string(), z.unknown())
    .default({})
    .describe("Operation-specific arguments. Read required_arguments from glitch_get_social_capabilities."),
  confirm: z
    .boolean()
    .default(false)
    .describe("Must be true for mutations, publishing, engagement, messaging, syncing, disconnects, and destructive operations.")
});

const startRunInput = z.object({
  ...optionalTitleShape,
  agent_id: idSchema.optional().describe("Specific Glitch title agent id. Omit to use the title's default MCP agent."),
  prompt: z.string().trim().min(1).max(8000).describe("The user-visible task for the Glitch Agent."),
  run_type: z.string().trim().min(1).max(80).default("manual"),
  trigger_source: z.string().trim().min(1).max(120).default("mcp"),
  live_mode: z.boolean().default(false).describe("Request live mode. Server-side billing, connection, and approval gates still apply."),
  background: z.boolean().default(true).describe("Queue the run and return immediately."),
  wait_for_completion: z.boolean().default(false).describe("Poll until the run completes, pauses for guidance/approval, fails, or times out."),
  timeout_ms: z.number().int().positive().max(600_000).default(120_000),
  poll_interval_ms: z.number().int().positive().max(30_000).default(2_000),
  attachment_ids: z.array(idSchema).max(20).default([]),
  tool_command: z.record(z.string(), z.unknown()).optional(),
  session_context: z.record(z.string(), z.unknown()).optional()
});

const runInput = z.object({
  ...optionalTitleShape,
  run_id: runIdSchema
});

const waitRunInput = z.object({
  ...optionalTitleShape,
  run_id: runIdSchema,
  timeout_ms: z.number().int().positive().max(900_000).default(180_000),
  poll_interval_ms: z.number().int().positive().max(30_000).default(2_000),
  stream: z
    .boolean()
    .default(true)
    .describe("Stream live events as progress/log notifications when the client supports them. Falls back to polling.")
});

const runEventsInput = z.object({
  ...optionalTitleShape,
  run_id: runIdSchema,
  after_id: idSchema.optional(),
  limit: z.number().int().positive().max(100).default(100)
});

const actionsInput = z.object({
  ...optionalTitleShape,
  run_id: runIdSchema.optional(),
  status: z
    .enum(["pending", "proposed", "needs_guidance", "needs_approval", "approved", "executed", "rejected", "failed", "canceled", "all"])
    .default("pending"),
  limit: z.number().int().positive().max(100).default(50)
});

const approveActionInput = z.object({
  ...optionalTitleShape,
  action_id: actionIdSchema,
  confirm: z.boolean().default(false).describe("Must be true. This prevents accidental model-triggered approvals."),
  note: z.string().trim().max(2000).optional()
});

const rejectActionInput = z.object({
  ...optionalTitleShape,
  action_id: actionIdSchema,
  reason: z.string().trim().min(1).max(2000).default("Rejected from MCP client.")
});

const executeActionInput = z.object({
  ...optionalTitleShape,
  action_id: actionIdSchema,
  confirm: z.boolean().default(false).describe("Must be true. Public, paid, or creator-facing work remains guarded server-side."),
  note: z.string().trim().max(2000).optional()
});

const guidanceInput = z.object({
  ...optionalTitleShape,
  run_id: runIdSchema.optional(),
  status: z.enum(["open", "answered", "dismissed", "all"]).default("open"),
  limit: z.number().int().positive().max(100).default(50)
});

const answerGuidanceInput = z.object({
  ...optionalTitleShape,
  guidance_id: guidanceIdSchema,
  answer: z.string().trim().min(1).max(8000),
  payload: z.record(z.string(), z.unknown()).optional()
});

const resolveGuidanceInput = z.object({
  ...optionalTitleShape,
  run_id: runIdSchema.optional().describe("Limit to guidance for a specific run."),
  guidance_id: guidanceIdSchema.optional().describe("Resolve a single guidance request."),
  limit: z.number().int().positive().max(10).default(5).describe("Maximum number of open questions to resolve in one call.")
});

const uploadUrlInput = z.object({
  ...optionalTitleShape,
  file_name: z.string().trim().min(1).max(255),
  mime_type: z.string().trim().min(1).max(120),
  size_bytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  agent_run_id: runIdSchema.optional()
});

const uploadFileInput = z.object({
  ...optionalTitleShape,
  agent_run_id: runIdSchema.optional().describe("Attach the file to a specific run."),
  file_path: z
    .string()
    .trim()
    .min(1)
    .max(4096)
    .optional()
    .describe("Path to a local file (image, video, or document) on the machine running this MCP. stdio only."),
  content_base64: z
    .string()
    .min(1)
    .max(MAX_UPLOAD_BASE64_CHARS)
    .optional()
    .describe("Base64-encoded file contents. Use this instead of file_path over the HTTP transport. Requires file_name."),
  file_name: z.string().trim().min(1).max(255).optional().describe("File name. Inferred from file_path when omitted; required with content_base64."),
  mime_type: z.string().trim().min(1).max(120).optional().describe("MIME type. Inferred from the file extension when omitted.")
});

const localProjectRootSchema = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .describe("Absolute or process-relative project root on the developer machine running this stdio MCP.");

const socialAssetFolderSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .describe("Relative folder under project_root to create or scan.");

const setupSocialAssetFoldersInput = z.object({
  project_root: localProjectRootSchema,
  folders: z.array(socialAssetFolderSchema).max(20).optional().describe("Optional custom relative folders. Defaults to Glitch's local social asset convention."),
  write_config: z.boolean().default(true).describe("Write .glitch/social-assets/config.json so future scans use the same roots."),
  confirm: z.boolean().default(false).describe("Must be true. Creates local folders on the developer machine.")
});

const scanLocalSocialAssetsInput = z.object({
  project_root: localProjectRootSchema,
  folders: z.array(socialAssetFolderSchema).max(20).optional().describe("Optional custom relative folders. Defaults to config.json, then Glitch's convention."),
  max_files: z.number().int().positive().max(500).default(50),
  max_depth: z.number().int().min(0).max(8).default(4),
  min_score: z.number().int().min(0).max(100).default(20),
  since_hours: z.number().positive().max(8760).optional().describe("Only include assets modified within this many hours."),
  write_manifest: z.boolean().default(true).describe("Write .glitch/social-assets/candidates.json for review and later upload selection.")
});

const startSocialAssetWatchInput = z.object({
  project_root: localProjectRootSchema,
  folders: z.array(socialAssetFolderSchema).max(20).optional().describe("Optional custom relative folders. Defaults to config.json, then Glitch's convention."),
  interval_hours: z.number().positive().max(168).default(24).describe("How often the stdio MCP process should rescan. Defaults to daily."),
  run_immediately: z.boolean().default(true).describe("Run a scan as soon as the watcher is activated."),
  max_files: z.number().int().positive().max(500).default(50),
  max_depth: z.number().int().min(0).max(8).default(4),
  min_score: z.number().int().min(0).max(100).default(20),
  since_hours: z.number().positive().max(8760).optional().describe("Only include assets modified within this many hours on each watcher scan."),
  confirm: z.boolean().default(false).describe("Must be true. Activates a local timer in this stdio MCP process.")
});

const stopSocialAssetWatchInput = z.object({
  project_root: localProjectRootSchema
});

const socialPlatformSchema = z.enum(["reddit", "tiktok", "instagram", "facebook", "bluesky", "discord", "youtube", "twitter", "telegram"]);

const uploadSocialAssetCandidatesInput = z.object({
  ...optionalTitleShape,
  project_root: localProjectRootSchema,
  candidate_ids: z.array(z.string().trim().min(1).max(80)).max(50).default([]).describe("Candidate ids from the latest scan manifest."),
  file_paths: z.array(z.string().trim().min(1).max(4096)).max(50).default([]).describe("Explicit local files to upload as Media without relying on a scan manifest."),
  upload_all_candidates: z.boolean().default(false).describe("Upload every candidate from the latest scan manifest."),
  agent_run_id: runIdSchema.optional().describe("Optional run id for audit/source metadata."),
  create_title_updates: z.boolean().default(true).describe("After AI media processing, create scheduler library TitleUpdates from the uploaded Media."),
  title_promotion_schedule_id: idSchema.optional().describe("Required when create_title_updates=true. Scheduler/library to receive TitleUpdates."),
  platforms: z.array(socialPlatformSchema).max(9).optional().describe("Optional platform filter/targets for the scheduler library item."),
  confirm: z.boolean().default(false).describe("Must be true. Uploads local files to Glitch as Media.")
});

const openDashboardInput = z.object({
  ...optionalTitleShape,
  kind: z.enum(["title", "run", "action", "billing", "hosting"]).default("title"),
  run_id: runIdSchema.optional(),
  action_id: actionIdSchema.optional()
});

const hostingDashboardInput = z.object({
  ...optionalTitleShape
});

const hostnameSchema = z
  .string()
  .trim()
  .min(4)
  .max(253)
  .regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i, "Use a complete hostname such as play.example.com.");

const hostingAnalyticsInput = z.object({
  ...optionalTitleShape,
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.").optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.").optional()
});

const createHostingSiteInput = z.object({
  ...optionalTitleShape,
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(63).regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
  mode: z.enum(["static", "server"]).default("static"),
  azure_region: z.string().trim().min(1).max(80).optional(),
  confirm: z.boolean().default(false).describe("Must be true. Creates a real hosted website under the title's business account.")
});

const updateHostingSiteInput = z.object({
  ...optionalTitleShape,
  site_id: idSchema,
  name: z.string().trim().min(1).max(120).optional(),
  mode: z.enum(["static", "server"]).optional(),
  azure_region: z.string().trim().min(1).max(80).optional(),
  configuration: z.record(z.string().trim().min(1).max(120), z.unknown()).optional().describe("Non-secret runtime settings only. Credentials, tokens, passwords, private keys, and connection strings are rejected."),
  confirm: z.boolean().default(false).describe("Must be true. Updates the live hosting site's configuration.")
});

const listHostingReleasesInput = z.object({
  ...optionalTitleShape,
  site_id: idSchema,
  per_page: z.number().int().min(1).max(100).default(20)
});

const connectHostingDomainInput = z.object({
  ...optionalTitleShape,
  site_id: idSchema,
  hostname: hostnameSchema,
  confirm: z.boolean().default(false).describe("Must be true. Begins managed DNS verification and secure routing for a domain you own.")
});

const verifyHostingDomainInput = z.object({
  ...optionalTitleShape,
  site_id: idSchema,
  domain_id: idSchema,
  confirm: z.boolean().default(false).describe("Must be true. Rechecks public DNS and activates the domain when its records are correct.")
});

const checkHostingDomainInput = z.object({
  ...optionalTitleShape,
  hostname: hostnameSchema
});

const domainContactSchema = z.object({
  first_name: z.string().trim().min(1).max(100),
  last_name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(255),
  phone: z.string().trim().min(1).max(40),
  address_line_1: z.string().trim().min(1).max(200),
  address_line_2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().min(1).max(100),
  country: z.string().trim().length(2).regex(/^[A-Za-z]{2}$/).describe("Two-letter country code."),
  postal_code: z.string().trim().min(1).max(30),
  organization: z.string().trim().max(200).optional()
});

const purchaseHostingDomainInput = z.object({
  ...optionalTitleShape,
  site_id: idSchema,
  hostname: hostnameSchema,
  auto_renew: z.boolean(),
  accepted_legal_terms: z.boolean().default(false).describe("Must be true after the registrant has reviewed the current registration agreements."),
  agreement_keys: z.array(z.string().trim().min(1).max(255)).min(1).max(25).describe("Agreement keys returned by glitch_check_hosting_domain."),
  contact: domainContactSchema,
  expected_annual_price_cents: z.number().int().positive(),
  billing_confirmation: z.string().trim().min(1).max(255).describe("Exact phrase returned by the availability check, for example PURCHASE DOMAIN example.com AT 2000 CENTS PER YEAR."),
  confirm: z.boolean().default(false).describe("Must be true. Creates a real secure-checkout session for domain registration.")
});

const hostingAiDatabaseSchema = z.object({
  name: z.string().trim().min(1).max(80),
  engine: z.enum(["postgresql", "mysql", "azure_sql", "cosmos_nosql", "redis"]),
  plan: z.enum(["sandbox", "launch", "growth", "scale", "dedicated", "cache_sandbox", "cache_launch", "cache_growth", "cache_scale"])
});

const hostingStackPresetSchema = z.enum(["single_server", "stateful_game_server", "web_and_api", "authoritative_world", "large_realtime_world"]);
const hostingServiceVolumeSchema = z.object({
  name: z.string().trim().min(1).max(63).regex(/^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
  mount_path: z.string().trim().min(1).max(255).regex(/^\//),
  size_gb: z.number().int().min(1).max(1024),
  access_mode: z.enum(["ReadOnly", "ReadWrite"]).optional()
});
const hostingServiceDefinitionSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  slug: z.string().trim().min(1).max(63).regex(/^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
  role: z.enum(["web", "api", "game", "realtime", "simulation", "worker", "scheduled"]).optional(),
  runtime: z.enum(["node", "python", "rust", "container"]).optional(),
  visibility: z.enum(["public", "internal", "none"]).optional(),
  is_primary: z.boolean().optional(),
  target_port: z.number().int().min(1).max(65535).optional(),
  transport: z.enum(["http", "http2", "tcp"]).optional(),
  health_check_path: z.string().trim().min(1).max(255).optional(),
  startup_check_path: z.string().trim().min(1).max(255).optional(),
  readiness_check_path: z.string().trim().min(1).max(255).optional(),
  liveness_check_path: z.string().trim().min(1).max(255).optional(),
  capacity_model: z.enum(["singleton", "replicated", "serverless"]).optional(),
  container_cpu: z.number().min(0.25).max(4).optional(),
  container_memory_mb: z.number().int().min(512).max(16384).optional(),
  min_replicas: z.number().int().min(0).max(25).optional(),
  max_replicas: z.number().int().min(1).max(25).optional(),
  schedule_cron: z.string().trim().min(1).max(120).optional(),
  termination_grace_seconds: z.number().int().min(1).max(600).optional(),
  depends_on: z.array(z.string().trim().min(1).max(63)).max(24).optional(),
  public_paths: z.array(z.string().trim().min(1).max(255).regex(/^\//)).max(20).optional(),
  volumes: z.array(hostingServiceVolumeSchema).max(10).optional(),
  environment: z.record(z.string().trim().min(1).max(120), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  database_bindings: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  configuration: z.record(z.string(), z.unknown()).optional(),
  command: z.array(z.string().max(2000)).max(20).optional(),
  arguments: z.array(z.string().max(2000)).max(50).optional(),
  game_build_id: idSchema.optional()
});

const hostingStackShape = {
  preset: hostingStackPresetSchema.optional(),
  game_build_id: idSchema.optional(),
  builds: z.record(z.string().trim().min(1).max(63), idSchema).optional(),
  services: z.array(hostingServiceDefinitionSchema).min(1).max(24).optional()
};

const listHostingServicesInput = z.object({ ...optionalTitleShape, site_id: idSchema });
const estimateHostingServicesInput = z.object({ ...optionalTitleShape, site_id: idSchema, ...hostingStackShape });
const applyHostingServicesInput = z.object({
  ...optionalTitleShape,
  site_id: idSchema,
  version: z.string().trim().min(1).max(80),
  ...hostingStackShape,
  test: z.object({ service: z.string().trim().min(1).max(63), command: z.array(z.string().max(2000)).min(1).max(20) }).optional(),
  migration: z.object({ service: z.string().trim().min(1).max(63), command: z.array(z.string().max(2000)).min(1).max(20) }).optional(),
  expected_monthly_floor_cents: z.number().int().nonnegative(),
  billing_confirmation: z.string().trim().min(1).max(255),
  confirm: z.boolean().default(false).describe("Must be true after the developer reviews the always-on floor and usage rates.")
});

const hostingAiInstructionsInput = z.object({
  ...optionalTitleShape,
  site_id: idSchema,
  framework: z.string().trim().min(1).max(120).optional(),
  custom_domain: hostnameSchema.optional(),
  databases: z.array(hostingAiDatabaseSchema).max(20).optional(),
  preset: hostingStackPresetSchema.optional(),
  version: z.string().trim().min(1).max(80).optional(),
  services: z.array(hostingServiceDefinitionSchema).max(24).optional()
});

const listHostingDatabasesInput = z.object({
  ...optionalTitleShape,
  site_id: idSchema,
  per_page: z.number().int().min(1).max(100).default(20)
});

const getHostingDatabaseInput = z.object({
  ...optionalTitleShape,
  site_id: idSchema,
  database_id: idSchema
});

const databasePlanSchema = z.enum(["sandbox", "launch", "growth", "scale", "cache_sandbox", "cache_launch", "cache_growth", "cache_scale"]);

const createHostingDatabaseInput = z.object({
  ...optionalTitleShape,
  site_id: idSchema,
  name: z.string().trim().min(3).max(80).regex(/^[a-z][a-z0-9-]{1,78}[a-z0-9]$/),
  engine: z.enum(["postgresql", "mysql", "azure_sql", "cosmos_nosql", "redis"]),
  plan: databasePlanSchema,
  azure_region: z.string().trim().min(1).max(80),
  auto_grow_enabled: z.boolean().default(false),
  high_availability_enabled: z.boolean().default(false),
  expected_monthly_price_cents: z.number().int().positive(),
  billing_confirmation: z.string().trim().min(1).max(255),
  confirm: z.boolean().default(false).describe("Must be true. Direct accounts receive secure Checkout; Microsoft Marketplace accounts start metered setup under their existing entitlement.")
});

const updateHostingDatabaseInput = z.object({
  ...optionalTitleShape,
  site_id: idSchema,
  database_id: idSchema,
  plan: databasePlanSchema.optional(),
  auto_grow_enabled: z.boolean().optional(),
  high_availability_enabled: z.boolean().optional(),
  expected_monthly_price_cents: z.number().int().positive(),
  billing_confirmation: z.string().trim().min(1).max(255),
  accept_proration: z.boolean().default(false).describe("Must be true when changing database size because the active billing provider may apply a prorated amount."),
  confirm: z.boolean().default(false).describe("Must be true. Applies a paid database change and may queue a managed resize.")
});

const retryHostingDatabaseInput = z.object({
  ...optionalTitleShape,
  site_id: idSchema,
  database_id: idSchema,
  expected_monthly_price_cents: z.number().int().positive(),
  billing_confirmation: z.string().trim().min(1).max(255),
  confirm: z.boolean().default(false).describe("Must be true. Retries provisioning or creates a replacement secure checkout for an unpaid database.")
});

const deleteHostingDatabaseInput = z.object({
  ...optionalTitleShape,
  site_id: idSchema,
  database_id: idSchema,
  confirmation: z.string().trim().min(1).max(80).describe("Exact database name. Deletion is rejected if it does not match."),
  confirm: z.boolean().default(false).describe("Must be true. Permanently deletes the database and finalizes billing.")
});

const changeHostingPlanInput = z.object({
  ...optionalTitleShape,
  plan: z.enum(["free", "launch", "growth", "scale", "studio"]),
  expected_monthly_price_cents: z.number().int().nonnegative(),
  billing_confirmation: z.string().trim().min(1).max(255),
  accept_proration: z.boolean().default(false).describe("Must be true when changing an active paid plan because billing may apply a prorated amount immediately."),
  confirm: z.boolean().default(false).describe("Must be true. Starts Checkout or changes the active Hosting subscription.")
});

const confirmHostingCheckoutInput = z.object({
  ...optionalTitleShape,
  checkout_session_id: z.string().trim().min(1).max(255).regex(/^cs_(?:test_|live_)?[A-Za-z0-9_]+$/),
  confirm: z.boolean().default(false).describe("Must be true. Confirms secure-checkout payment and may begin hosting or database setup.")
});

const deployHostingBuildInput = z.object({
  ...optionalTitleShape,
  game_build_id: idSchema.describe("Ready Glitch game build id. Call glitch_list_deployments first; upload a local ZIP only when no compatible build exists."),
  site_id: idSchema.optional().describe("Hosting site id. When omitted, the only existing site is used, or a new site is created from site_name/site_slug."),
  site_name: z.string().trim().min(1).max(120).optional(),
  site_slug: z.string().trim().min(1).max(63).regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/).optional(),
  site_mode: z.enum(["static", "server"]).optional().describe("Used only when creating a site. Defaults to server for Node builds and static otherwise."),
  azure_region: z.string().trim().min(1).max(80).optional(),
  version: z.string().trim().min(1).max(80),
  entry_point: z.string().trim().min(1).max(500).default("index.html").refine((value) => !value.includes("..") && !value.startsWith("/"), "Use a safe relative entry point."),
  publish: z.boolean().default(true).describe("Publish the ready release to the site's generated/custom domains. False prepares the release without changing the live site."),
  timeout_ms: z.number().int().positive().max(900_000).default(300_000),
  poll_interval_ms: z.number().int().positive().max(30_000).default(2_000),
  confirm: z.boolean().default(false).describe("Must be true. Creates a hosting release and may publish it publicly.")
});

const promoteHostingReleaseInput = z.object({
  ...optionalTitleShape,
  site_id: idSchema,
  release_id: idSchema,
  confirm: z.boolean().default(false).describe("Must be true. Changes the live hosted website to this release.")
});

export const glitchToolDefinitions: readonly GlitchToolDefinition[] = [
  defineTool("glitch_auth_status", "Glitch Auth Status", "Check whether the current user token or title MCP token can access Glitch MCP.", authStatusInput, true, async (client, input) => {
    const data = await client.authStatus(input.title_id);
    return toolSuccess({
      title: "Glitch authentication status",
      summary: "The hosted Glitch MCP service returned the current auth and entitlement status.",
      data
    });
  }),

  defineTool("glitch_list_titles", "List Glitch Titles", "List game titles available to the authenticated Glitch user or title MCP token.", listTitlesInput, true, async (client, input) => {
    const data = await client.listTitles(input.include_archived);
    return toolSuccess({
      title: "Glitch titles",
      summary: "Titles visible to this MCP credential.",
      data,
      bodyMarkdown: presentTitles(data)
    });
  }),

  defineTool("glitch_select_title", "Select Glitch Title", "Select a title for this MCP process after verifying access with the hosted Glitch service.", selectTitleInput, true, async (client, input) => {
    const data = await client.selectTitle(input.title_id);
    return toolSuccess({
      title: "Glitch title selected",
      summary: `Selected ${input.title_id} for subsequent tool calls in this MCP session.`,
      data,
      links: [{ name: "Open title workspace", url: client.dashboardUrl("title", { titleId: input.title_id }) }]
    });
  }),

  defineTool("glitch_get_title_context", "Get Title Context", "Fetch safe, subscription-gated context for a game title.", titleContextInput, true, async (client, input) => {
    const titleId = client.resolveTitleId(input.title_id);
    const data = await client.titleContext(titleId);
    return toolSuccess({
      title: "Glitch title context",
      summary: "Safe title context is available in structuredContent.data.",
      data,
      links: [{ name: "Open title workspace", url: client.dashboardUrl("title", { titleId }) }]
    });
  }),

  defineTool(
    "glitch_list_game_development_prompts",
    "List AI Game Development Prompts",
    "Discover Glitch's public AI game-development prompt library by category or search term. Every prompt requires the game documentation to be created or updated.",
    listGameDevelopmentPromptsInput,
    true,
    async (_client, input) => {
      const prompts = filterGameDevelopmentPrompts({
        category: input.category,
        ...(input.search ? { search: input.search } : {})
      }).map((prompt) => ({
        id: prompt.id,
        category: prompt.category,
        eyebrow: prompt.eyebrow,
        title: prompt.title,
        description: prompt.description,
        best_for: prompt.bestFor,
        resource_uri: gameDevelopmentPromptResourceUri(prompt.id),
        url: gameDevelopmentPromptUrl(prompt.id)
      }));

      return toolSuccess({
        title: "AI game development prompts",
        summary: `Found ${prompts.length} public prompt${prompts.length === 1 ? "" : "s"}. Use glitch_get_game_development_prompt for the complete Markdown.`,
        data: {
          count: prompts.length,
          categories: GAME_DEVELOPMENT_PROMPT_CATEGORIES,
          prompts
        },
        bodyMarkdown: prompts.length
          ? prompts.map((prompt) => `- **${prompt.title}** (\`${prompt.id}\`) — ${prompt.description}`).join("\n")
          : "No prompts matched the supplied filters."
      });
    }
  ),

  defineTool(
    "glitch_get_game_development_prompt",
    "Get AI Game Development Prompt",
    "Return the complete public Markdown for one AI game-development prompt, including its required documentation instructions.",
    getGameDevelopmentPromptInput,
    true,
    async (_client, input) => {
      const prompt = getGameDevelopmentPrompt(input.prompt_id);
      if (!prompt) {
        throw new GlitchMcpError("not_found", `Unknown game-development prompt id: ${input.prompt_id}`);
      }

      const url = gameDevelopmentPromptUrl(prompt.id);
      return toolSuccess({
        title: prompt.title,
        summary: `${prompt.description} Best for: ${prompt.bestFor}`,
        data: {
          ...prompt,
          resource_uri: gameDevelopmentPromptResourceUri(prompt.id),
          url
        },
        bodyMarkdown: prompt.prompt,
        links: [{ name: "Open this prompt on Glitch", url }]
      });
    }
  ),

  defineTool(
    "glitch_list_game_genres",
    "List Game Genres",
    "Fetch Glitch's live, alphabetized game genre taxonomy for multi-genre game-design inputs.",
    listGameGenresInput,
    true,
    async (client) => {
      const genres = await client.listGameGenres();
      const genreNames = genres.map(genreDisplayName).filter((name): name is string => Boolean(name));
      return toolSuccess({
        title: "Glitch game genres",
        summary: `Fetched ${genres.length} genres from the live Glitch API. A game-design blueprint may select up to eight.`,
        data: { genres },
        ...(genreNames.length ? { bodyMarkdown: genreNames.map((name) => `- ${name}`).join("\n") } : {})
      });
    }
  ),

  defineTool(
    "glitch_generate_game_design_blueprint",
    "Generate Game Mechanics and Core Loop",
    "Generate a reusable descriptor, mechanics, core verbs, design pillars, moment-to-moment core loop, session loop, and documentation instruction for any game. This OpenAI-backed request may take about a minute.",
    generateGameDesignBlueprintInput,
    true,
    async (client, input, ctx) => {
      await ctx?.log("info", "Generating the game mechanics and core-loop blueprint. This may take about a minute…");
      await ctx?.progress(1, 2, "Generating mechanics and core loop…");

      const request = omitUndefined({
        gameName: input.game_name,
        genre: gameDesignGenreProfile(input.genres[0]!),
        genres: input.genres,
        playMode: input.play_mode,
        sessionLength: input.session_length,
        playerFantasy: input.player_fantasy,
        setting: input.setting,
        primaryGoal: input.primary_goal,
        mainPressure: input.main_pressure,
        signatureTwist: input.signature_twist,
        progression: input.progression,
        preferredActivities: input.preferred_activities
      });

      let data: JsonObject;
      let usedLocalFallback = false;
      try {
        data = await client.generateGameDesignBlueprint(request);
      } catch {
        usedLocalFallback = true;
        await ctx?.log(
          "warning",
          "The hosted OpenAI game-design route was unavailable; using the deterministic documentation-ready fallback."
        );
        data = buildGameDesignBlueprint(request) as JsonObject;
      }

      await ctx?.progress(2, 2, usedLocalFallback ? "Fallback game-design blueprint ready" : "Game-design blueprint ready");
      await ctx?.log("info", "The blueprint is ready and includes the required game-documentation destination.");

      return toolSuccess({
        title: "Game mechanics and core-loop blueprint",
        summary: `${usedLocalFallback ? "Generated the deterministic fallback because the hosted OpenAI route was unavailable." : "Generated an AI-assisted design blueprint."} Save or update it in the game's documentation as instructed by the result.`,
        data,
        bodyMarkdown: presentGameDesignBlueprint(data)
      });
    }
  ),

  defineTool("glitch_get_analytics_capabilities", "Get Analytics Capabilities", "List every canonical read-only Glitch analytics family, report key, filter, source route, default, requirement, and safety limit.", analyticsCapabilitiesInput, true, async (client, input) => {
    const titleId = client.resolveTitleId(input.title_id);
    const data = await client.analyticsCapabilities(titleId);
    return toolSuccess({
      title: "Glitch analytics capabilities",
      summary: "The hosted service returned the authoritative analytics report catalog.",
      data,
      bodyMarkdown: presentAnalytics(data),
      links: [{ name: "Open title analytics", url: client.dashboardUrl("title", { titleId }) }]
    });
  }),

  defineTool("glitch_get_analytics_report", "Get Analytics Report", "Run one canonical dashboard analytics report without starting or billing an Agent run. Call glitch_get_analytics_capabilities for valid keys and filters.", analyticsReportInput, true, async (client, input) => {
    const titleId = client.resolveTitleId(input.title_id);
    const data = await client.analyticsQuery(titleId, {
      reports: [{ key: input.report_key, filters: input.filters }],
      fail_fast: input.fail_fast
    });
    return toolSuccess({
      title: "Glitch analytics report",
      summary: `Generated ${input.report_key} from the canonical Glitch dashboard report path.`,
      data,
      bodyMarkdown: presentAnalytics(data),
      links: [{ name: "Open title analytics", url: client.dashboardUrl("title", { titleId }) }]
    });
  }),

  analyticsFamilyTool("glitch_get_session_reports", "Get Session Reports", "sessions", "Get session details, duration, retention, DAU/WAU/MAU, cohorts, geography, and behavioral-funnel reports."),
  analyticsFamilyTool("glitch_get_web_reports", "Get Web Analytics Reports", "web", "Get website traffic, page, event, engagement, source, UTM, device, geography, journey, and landing-page reports."),
  analyticsFamilyTool("glitch_get_storefront_reports", "Get Storefront Analytics Reports", "storefront", "Get the canonical report bundle behind storefront, discovery, load, playtime, conversion, and readiness analytics."),
  analyticsFamilyTool("glitch_get_wishlist_reports", "Get Wishlist Reports", "wishlist", "Get wishlist growth, intent, forecast, conversion, influencer, ad, UTM, geography, and device reports."),
  analyticsFamilyTool("glitch_get_earnings_reports", "Get Earnings Reports", "earnings", "Get developer earnings, payouts, purchases, revenue trends, LTV, currency, item, install, and ad-revenue reports."),
  analyticsFamilyTool("glitch_get_attribution_reports", "Get Attribution Reports", "attribution", "Get title, ad, UTM, influencer, social-post, conversion-event, install-journey, and paid-media attribution reports."),
  analyticsFamilyTool("glitch_get_cross_device_reports", "Get Cross-Device Reports", "cross_device", "Get identity, journey, attribution-funnel, device-environment, geography, fraud, pixel, and conversion-correlation reports."),

  defineTool("glitch_get_billing_status", "Get Billing Status", "Check subscription, trial, plan, and credit state for a title.", billingInput, true, async (client, input) => {
    const titleId = client.resolveTitleId(input.title_id);
    const data = await client.billingStatus(titleId);
    return toolSuccess({
      title: "Glitch billing status",
      summary: "Billing and entitlement status for this title.",
      data,
      bodyMarkdown: presentBilling(data),
      links: [{ name: "Open billing", url: client.dashboardUrl("billing", { titleId }) }]
    });
  }),

  defineTool(
    "glitch_get_social_capabilities",
    "Get Social Capabilities",
    "List every title-scoped social operation, required argument, platform capability, connected scheduler, and permission category available through Glitch.",
    socialCapabilitiesInput,
    true,
    async (client, input) => {
      const titleId = client.resolveTitleId(input.title_id);
      const data = await client.socialCapabilities(titleId);
      return toolSuccess({
        title: "Glitch social capabilities",
        summary: "The hosted service returned the authoritative social platform and operation catalog for this title.",
        data,
        links: [{ name: "Open social workspace", url: client.dashboardUrl("title", { titleId }) }]
      });
    }
  ),

  defineTool(
    "glitch_social_operation",
    "Run Social Operation",
    "Run a deterministic title-scoped Glitch social operation. Call glitch_get_social_capabilities first to discover operation names, permissions, confirmation requirements, platform support, and required arguments. OAuth credentials are never accepted or returned.",
    socialOperationInput,
    false,
    async (client, input) => {
      const titleId = client.resolveTitleId(input.title_id);
      const data = await client.socialOperation(titleId, input.operation, input.arguments, input.confirm);
      return toolSuccess({
        title: "Glitch social operation",
        summary: `Glitch completed social operation ${input.operation}.`,
        data,
        links: [{ name: "Open social workspace", url: client.dashboardUrl("title", { titleId }) }]
      });
    }
  ),

  defineTool("glitch_start_agent_run", "Start Agent Run", "Start a paid Glitch Agent run for a title. Subscription and title permissions are enforced by Glitch.", startRunInput, false, async (client, input) => {
    const titleId = client.resolveTitleId(input.title_id);
    const run = await client.startRun(titleId, omitUndefined({
      agent_id: input.agent_id,
      initial_message: input.prompt,
      run_type: input.run_type,
      trigger_source: input.trigger_source,
      live_mode: input.live_mode,
      background: input.background,
      attachment_ids: input.attachment_ids,
      tool_command: input.tool_command,
      session_context: input.session_context
    }));

    const runId = String(run.id || run.run_id || "");
    const data = input.wait_for_completion && runId
      ? await client.waitForRun(titleId, runId, input.timeout_ms, input.poll_interval_ms)
      : run;

    return toolSuccess({
      title: "Glitch agent run started",
      summary: runId ? `Run ${runId} was accepted by Glitch.` : "The run was accepted by Glitch.",
      data,
      bodyMarkdown: presentRun(data),
      links: [{ name: "Open run", url: client.dashboardUrl("run", { titleId, runId }) }],
      uiResourceUri: "ui://glitch/run-status.html"
    });
  }),

  defineTool("glitch_get_agent_run", "Get Agent Run", "Fetch a durable Glitch Agent run with status, actions, guidance, events, files, and final report when available.", runInput, true, async (client, input) => {
    const titleId = client.resolveTitleId(input.title_id);
    const data = await client.getRun(titleId, input.run_id);
    return toolSuccess({
      title: "Glitch agent run",
      summary: `Fetched run ${input.run_id}.`,
      data,
      bodyMarkdown: presentRun(data),
      links: [{ name: "Open run", url: client.dashboardUrl("run", { titleId, runId: input.run_id }) }],
      uiResourceUri: "ui://glitch/run-status.html"
    });
  }),

  defineTool("glitch_wait_for_agent_run", "Wait For Agent Run", "Wait for a Glitch Agent run until it completes, pauses for approval/guidance, fails, is canceled, or times out. Streams live events as progress/log notifications when the client supports them.", waitRunInput, true, async (client, input, ctx) => {
    const titleId = client.resolveTitleId(input.title_id);

    let data: JsonObject;
    if (input.stream && ctx?.streamingEnabled) {
      let eventCount = 0;
      await ctx.log("info", `Watching Glitch run ${input.run_id} for live updates…`);
      data = await client.waitForRunStreaming(titleId, input.run_id, {
        timeoutMs: input.timeout_ms,
        pollIntervalMs: input.poll_interval_ms,
        ...(ctx.signal ? { signal: ctx.signal } : {}),
        onEvent: async (message) => {
          if (message.event === "run_event") {
            eventCount += 1;
            const text =
              typeof message.data.message === "string"
                ? message.data.message
                : String(message.data.event_type ?? "event");
            await ctx.log("info", text);
            await ctx.progress(eventCount, undefined, text);
          } else if (message.event === "status") {
            await ctx.log("info", `Run status: ${String(message.data.status ?? "unknown")}`);
          }
        }
      });
    } else {
      data = await client.waitForRun(titleId, input.run_id, input.timeout_ms, input.poll_interval_ms);
    }

    return toolSuccess({
      title: "Glitch agent run wait result",
      summary: data.timed_out ? "Still running when the wait timed out." : "The run reached a settled state.",
      data,
      bodyMarkdown: presentRun(data),
      links: [{ name: "Open run", url: client.dashboardUrl("run", { titleId, runId: input.run_id }) }],
      uiResourceUri: "ui://glitch/run-status.html"
    });
  }),

  defineTool("glitch_list_run_events", "List Run Events", "List user-visible timeline events for a Glitch Agent run.", runEventsInput, true, async (client, input) => {
    const titleId = client.resolveTitleId(input.title_id);
    const data = await client.runEvents(titleId, input.run_id, {
      after_id: input.after_id,
      limit: input.limit
    });
    return toolSuccess({
      title: "Glitch run events",
      summary: `Fetched events for run ${input.run_id}.`,
      data,
      links: [{ name: "Open run", url: client.dashboardUrl("run", { titleId, runId: input.run_id }) }]
    });
  }),

  defineTool("glitch_get_final_report", "Get Final Report", "Fetch the human-friendly final or partial report for a Glitch Agent run.", runInput, true, async (client, input) => {
    const titleId = client.resolveTitleId(input.title_id);
    const data = await client.finalReport(titleId, input.run_id);
    return toolSuccess({
      title: "Glitch final report",
      summary: `Fetched report for run ${input.run_id}.`,
      data,
      bodyMarkdown: presentFinalReport(data),
      links: [{ name: "Open report", url: client.dashboardUrl("run", { titleId, runId: input.run_id }) }],
      uiResourceUri: "ui://glitch/report-dashboard.html"
    });
  }),

  defineTool("glitch_list_artifacts", "List Artifacts", "List downloadable files and hosted report artifacts for a Glitch Agent run.", runInput, true, async (client, input) => {
    const titleId = client.resolveTitleId(input.title_id);
    const data = await client.artifacts(titleId, input.run_id);
    return toolSuccess({
      title: "Glitch run artifacts",
      summary: `Fetched artifacts for run ${input.run_id}.`,
      data,
      bodyMarkdown: presentArtifacts(data),
      links: [{ name: "Open run", url: client.dashboardUrl("run", { titleId, runId: input.run_id }) }],
      uiResourceUri: "ui://glitch/artifact-gallery.html"
    });
  }),

  defineTool("glitch_list_pending_actions", "List Pending Actions", "List proposed, guidance-needed, approval-needed, approved, or executed actions for a title.", actionsInput, true, async (client, input) => {
    const titleId = client.resolveTitleId(input.title_id);
    const data = await client.pendingActions(titleId, {
      run_id: input.run_id,
      status: input.status,
      limit: input.limit
    });
    return toolSuccess({
      title: "Glitch agent actions",
      summary: "Proposed, approval-needed, and executed actions for this title.",
      data,
      bodyMarkdown: presentActions(data),
      links: [{ name: "Open action queue", url: client.dashboardUrl("title", { titleId }) }],
      uiResourceUri: "ui://glitch/approval-queue.html"
    });
  }),

  defineTool("glitch_approve_action", "Approve Action", "Approve a reviewable Glitch Agent action. Execution still remains subject to server-side guardrails.", approveActionInput, false, async (client, input) => {
    requireConfirmation(input.confirm, "Approving an agent action");
    const titleId = client.resolveTitleId(input.title_id);
    const data = await client.approveAction(titleId, input.action_id, omitUndefined({ note: input.note, source: "mcp" }));
    return toolSuccess({
      title: "Glitch action approved",
      summary: `Approved action ${input.action_id}.`,
      data,
      links: [{ name: "Open action", url: client.dashboardUrl("action", { titleId, actionId: input.action_id }) }]
    });
  }),

  defineTool("glitch_reject_action", "Reject Action", "Reject a proposed or approval-needed Glitch Agent action.", rejectActionInput, false, async (client, input) => {
    const titleId = client.resolveTitleId(input.title_id);
    const data = await client.rejectAction(titleId, input.action_id, { reason: input.reason, source: "mcp" });
    return toolSuccess({
      title: "Glitch action rejected",
      summary: `Rejected action ${input.action_id}.`,
      data,
      links: [{ name: "Open action", url: client.dashboardUrl("action", { titleId, actionId: input.action_id }) }]
    });
  }),

  defineTool("glitch_execute_action", "Execute Action", "Execute an approved Glitch Agent action. Public, paid, and creator-facing work remains guarded by Glitch.", executeActionInput, false, async (client, input) => {
    requireConfirmation(input.confirm, "Executing an agent action");
    const titleId = client.resolveTitleId(input.title_id);
    const data = await client.executeAction(titleId, input.action_id, omitUndefined({ note: input.note, source: "mcp" }));
    return toolSuccess({
      title: "Glitch action execution requested",
      summary: `Execution requested for action ${input.action_id}.`,
      data,
      links: [{ name: "Open action", url: client.dashboardUrl("action", { titleId, actionId: input.action_id }) }]
    });
  }),

  defineTool("glitch_list_guidance", "List Guidance", "List open or answered guidance requests for a title or run.", guidanceInput, true, async (client, input) => {
    const titleId = client.resolveTitleId(input.title_id);
    const data = await client.guidance(titleId, {
      run_id: input.run_id,
      status: input.status,
      limit: input.limit
    });
    return toolSuccess({
      title: "Glitch guidance requests",
      summary: "Open and answered guidance requests for this title.",
      data,
      bodyMarkdown: presentGuidance(data),
      links: [{ name: "Open title workspace", url: client.dashboardUrl("title", { titleId }) }],
      uiResourceUri: "ui://glitch/guidance-form.html"
    });
  }),

  defineTool("glitch_answer_guidance", "Answer Guidance", "Answer a Glitch Agent guidance request and resume the server-side workflow when possible.", answerGuidanceInput, false, async (client, input) => {
    const titleId = client.resolveTitleId(input.title_id);
    const data = await client.answerGuidance(titleId, input.guidance_id, omitUndefined({
      answer: input.answer,
      payload: input.payload,
      source: "mcp"
    }));
    return toolSuccess({
      title: "Glitch guidance answered",
      summary: `Answered guidance request ${input.guidance_id}.`,
      data,
      links: [{ name: "Open title workspace", url: client.dashboardUrl("title", { titleId }) }]
    });
  }),

  defineTool("glitch_resolve_guidance", "Resolve Guidance", "Present the agent's open stop-gate questions to the user as interactive multiple-choice prompts (MCP elicitation) and route each answer back to resume the run. Falls back to a readable question list when the client cannot show prompts.", resolveGuidanceInput, false, async (client, input, ctx) => {
    const titleId = client.resolveTitleId(input.title_id);
    const data = await client.guidance(titleId, omitUndefined({
      run_id: input.run_id,
      status: "open",
      limit: input.limit
    }));

    let items = toArray(data.items).map(toRecord).filter((item): item is JsonObject => item !== undefined);
    if (input.guidance_id) {
      items = items.filter((item) => String(item.id) === input.guidance_id);
    }

    const titleLink = [{ name: "Open title workspace", url: client.dashboardUrl("title", { titleId }) }];

    if (items.length === 0) {
      return toolSuccess({
        title: "Glitch guidance",
        summary: "No open guidance to resolve.",
        data: { resolved: [], open_count: 0 },
        bodyMarkdown: "There are no open questions from the agent right now.",
        links: titleLink
      });
    }

    // Fallback: the client cannot show interactive prompts. Return the questions as
    // readable multiple choice and let the model/user answer with glitch_answer_guidance.
    if (!ctx?.canElicit) {
      return toolSuccess({
        title: "Glitch guidance (manual answer)",
        summary: "This client cannot show interactive prompts. Review each question and answer with glitch_answer_guidance.",
        data: { items, open_count: items.length, interactive: false },
        bodyMarkdown: `${presentGuidance({ items })}\n\nAnswer with **glitch_answer_guidance** (pass guidance_id and your chosen option text).`,
        links: titleLink
      });
    }

    const resolved: JsonObject[] = [];
    for (const guidance of items) {
      const guidanceId = String(guidance.id || "");
      if (!guidanceId) {
        continue;
      }

      const prompt = buildGuidanceElicitation(guidance);
      const outcome = await ctx.elicit({ message: prompt.message, requestedSchema: prompt.requestedSchema });

      if (outcome.action !== "accept" || !outcome.content) {
        // Respect decline/cancel: never answer on the user's behalf.
        resolved.push({ guidance_id: guidanceId, status: outcome.action });
        continue;
      }

      const selectedValue = String(outcome.content.answer ?? "").trim();
      if (!selectedValue) {
        resolved.push({ guidance_id: guidanceId, status: "skipped_no_answer" });
        continue;
      }
      const notes = typeof outcome.content.notes === "string" ? outcome.content.notes.trim() : "";
      const option = prompt.optionByValue.get(selectedValue);
      const answerText = option?.label || selectedValue;

      const result = await client.answerGuidance(titleId, guidanceId, omitUndefined({
        answer: answerText,
        selected_option: selectedValue,
        notes: notes || undefined,
        payload: option ? { id: selectedValue, label: option.label } : { answer: selectedValue },
        source: "mcp_elicitation"
      }));

      resolved.push({ guidance_id: guidanceId, status: "answered", selected: answerText, result });
    }

    const answeredCount = resolved.filter((entry) => entry.status === "answered").length;
    return toolSuccess({
      title: "Glitch guidance resolved",
      summary: `Routed ${answeredCount} of ${items.length} answer(s) back to the agent.`,
      data: { resolved, interactive: true },
      bodyMarkdown: presentGuidanceResolution(resolved),
      links: titleLink
    });
  }),

  defineTool("glitch_setup_social_asset_folders", "Setup Social Asset Folders", "Create the local Glitch social asset folders and config under a developer's game project.", setupSocialAssetFoldersInput, false, async (client, input) => {
    requireConfirmation(input.confirm, "Creating local Glitch social asset folders");
    assertCanReadLocalFiles(client, "set up local social asset folders");
    await assertLocalPathAllowed(input.project_root, client.uploadAllowedRoots, "Project root");

    const result = await setupSocialAssetFolders(
      input.project_root,
      input.folders ?? DEFAULT_SOCIAL_ASSET_FOLDERS,
      input.write_config
    );

    return toolSuccess({
      title: "Glitch social asset folders ready",
      summary: `Created or verified ${result.created_or_verified.length} local social asset folder(s).`,
      data: result as unknown as JsonObject,
      bodyMarkdown: presentSocialAssetSetup(result)
    });
  }),

  defineTool("glitch_scan_local_social_assets", "Scan Local Social Assets", "Scan local game capture folders for screenshot, trailer, and marketing candidates that could become Glitch Media.", scanLocalSocialAssetsInput, false, async (client, input) => {
    assertCanReadLocalFiles(client, "scan local social asset folders");
    await assertLocalPathAllowed(input.project_root, client.uploadAllowedRoots, "Project root");

    const result = await scanSocialAssetFolders(input.project_root, {
      ...(input.folders ? { folders: input.folders } : {}),
      maxFiles: input.max_files,
      maxDepth: input.max_depth,
      minScore: input.min_score,
      ...(input.since_hours ? { sinceHours: input.since_hours } : {}),
      writeManifest: input.write_manifest
    });

    return toolSuccess({
      title: "Glitch local social asset scan",
      summary: `Found ${result.candidates.length} candidate social asset(s).`,
      data: result as unknown as JsonObject,
      bodyMarkdown: presentSocialAssetScan(result)
    });
  }),

  defineTool("glitch_start_social_asset_watch", "Start Social Asset Watch", "Activate an opt-in daily local scan timer for Glitch social asset folders in this stdio MCP process.", startSocialAssetWatchInput, false, async (client, input) => {
    requireConfirmation(input.confirm, "Activating the local Glitch social asset watcher");
    assertCanReadLocalFiles(client, "watch local social asset folders");
    await assertLocalPathAllowed(input.project_root, client.uploadAllowedRoots, "Project root");

    const result = await startSocialAssetWatch(input.project_root, {
      intervalHours: input.interval_hours,
      runImmediately: input.run_immediately,
      scanOptions: {
        ...(input.folders ? { folders: input.folders } : {}),
        max_files: input.max_files,
        max_depth: input.max_depth,
        min_score: input.min_score,
        ...(input.since_hours ? { since_hours: input.since_hours } : {}),
        write_manifest: true
      }
    });

    return toolSuccess({
      title: "Glitch social asset watcher active",
      summary: `Local watcher enabled; rescans every ${result.interval_hours} hour(s).`,
      data: result as unknown as JsonObject,
      bodyMarkdown: presentSocialAssetWatch(result)
    });
  }),

  defineTool("glitch_stop_social_asset_watch", "Stop Social Asset Watch", "Disable the local Glitch social asset folder watcher for this project.", stopSocialAssetWatchInput, false, async (client, input) => {
    assertCanReadLocalFiles(client, "stop watching local social asset folders");
    await assertLocalPathAllowed(input.project_root, client.uploadAllowedRoots, "Project root");

    const result = await stopSocialAssetWatch(input.project_root);

    return toolSuccess({
      title: "Glitch social asset watcher stopped",
      summary: "Local watcher disabled for this project.",
      data: result as unknown as JsonObject,
      bodyMarkdown: presentSocialAssetWatch(result)
    });
  }),

  defineTool("glitch_upload_social_asset_candidates", "Upload Social Asset Candidates", "Upload selected local scan candidates to Glitch as Media so AI processing can promote them into scheduler library TitleUpdates.", uploadSocialAssetCandidatesInput, false, async (client, input) => {
    requireConfirmation(input.confirm, "Uploading local social assets to Glitch Media");
    assertCanReadLocalFiles(client, "upload local social asset candidates");
    await assertLocalPathAllowed(input.project_root, client.uploadAllowedRoots, "Project root");

    if (input.create_title_updates && !input.title_promotion_schedule_id) {
      throw new GlitchMcpError(
        "validation_error",
        "title_promotion_schedule_id is required when create_title_updates=true. Create or select a scheduler in Glitch, then pass that scheduler id."
      );
    }

    const titleId = client.resolveTitleId(input.title_id);
    const selections = await resolveSocialAssetUploadSelections(input.project_root, {
      candidateIds: input.candidate_ids,
      filePaths: input.file_paths,
      uploadAllCandidates: input.upload_all_candidates
    });

    if (selections.length === 0) {
      throw new GlitchMcpError("validation_error", "No social assets selected. Pass candidate_ids, file_paths, or upload_all_candidates=true.");
    }

    const uploaded: JsonObject[] = [];
    for (const selection of selections) {
      const { bytes, fileName } = await loadUploadBytes(client, {
        file_path: selection.filePath,
        file_name: selection.candidate?.file_name
      });
      const mimeType = selection.candidate?.mime_type || mimeTypeForSocialAsset(fileName);
      if (!mimeType) {
        throw new GlitchMcpError("validation_error", `File "${fileName}" is not an image or video type accepted as a Glitch social Media asset.`);
      }

      const sourceMetadata = omitUndefined({
        source: "mcp_local_social_asset",
        project_root: selection.projectRoot,
        file_path: selection.filePath,
        relative_path: selection.candidate?.relative_path,
        candidate_id: selection.candidate?.id,
        sha256: selection.sha256,
        score: selection.candidate?.score,
        reasons: selection.candidate?.reasons,
        suggested_platforms: selection.candidate?.suggested_platforms
      });

      const data = await client.uploadMediaAsset(titleId, {
        bytes,
        fileName,
        mimeType,
        ...(input.agent_run_id ? { agentRunId: input.agent_run_id } : {}),
        createTitleUpdate: input.create_title_updates,
        ...(input.title_promotion_schedule_id ? { titlePromotionScheduleId: input.title_promotion_schedule_id } : {}),
        ...(input.platforms ? { platforms: input.platforms } : {}),
        sourceMetadata
      });

      uploaded.push({
        file_path: selection.filePath,
        file_name: fileName,
        mime_type: mimeType,
        candidate_id: selection.candidate?.id ?? null,
        response: data
      });
    }

    return toolSuccess({
      title: "Glitch social Media uploaded",
      summary: `Uploaded ${uploaded.length} local social asset(s) as Glitch Media.`,
      data: { uploaded, count: uploaded.length },
      bodyMarkdown: presentSocialAssetUpload(uploaded),
      links: [{ name: "Open title media library", url: client.dashboardUrl("title", { titleId }) }]
    });
  }),

  defineTool("glitch_create_upload_url", "Create Upload URL", "Create a short-lived upload URL for attaching a file to a Glitch Agent title or run.", uploadUrlInput, false, async (client, input) => {
    const titleId = client.resolveTitleId(input.title_id);
    const data = await client.createUploadUrl(titleId, omitUndefined({
      file_name: input.file_name,
      mime_type: input.mime_type,
      size_bytes: input.size_bytes,
      agent_run_id: input.agent_run_id
    }));
    return toolSuccess({
      title: "Glitch upload URL",
      summary: "Use the returned URL exactly as instructed by Glitch. Uploaded files remain reference material, not trusted instructions.",
      data,
      links: [{ name: "Open title workspace", url: client.dashboardUrl("title", { titleId }) }]
    });
  }),

  defineTool("glitch_upload_file", "Upload File", "Upload a local image, video, or document (e.g. a screenshot, gameplay clip, or brief) to a Glitch title or run. Files become run attachments and potential social assets, treated as reference material behind the prompt-injection boundary.", uploadFileInput, false, async (client, input) => {
    const titleId = client.resolveTitleId(input.title_id);
    const { bytes, fileName } = await loadUploadBytes(client, input);
    const mimeType = inferMimeType(fileName, input.mime_type);

    if (bytes.byteLength > MAX_UPLOAD_BYTES) {
      throw new GlitchMcpError(
        "validation_error",
        `File is ${(bytes.byteLength / (1024 * 1024)).toFixed(1)} MB, which exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB limit.`
      );
    }

    const data = await client.uploadFile(titleId, {
      bytes,
      fileName,
      mimeType,
      ...(input.agent_run_id ? { agentRunId: input.agent_run_id } : {})
    });

    return toolSuccess({
      title: "Glitch file uploaded",
      summary: `Uploaded ${fileName} (${mimeType}) to Glitch. It is reference material, not trusted instructions.`,
      data,
      links: [{ name: "Open title workspace", url: client.dashboardUrl("title", { titleId }) }]
    });
  }),

  defineTool("glitch_open_dashboard", "Open Dashboard Links", "Return Glitch dashboard links for a title, run, action, or billing screen.", openDashboardInput, true, async (client, input) => {
    const titleId = client.resolveTitleId(input.title_id);
    const linkInput: { titleId: string; runId?: string; actionId?: string } = {
      titleId,
      ...(input.run_id ? { runId: input.run_id } : {}),
      ...(input.action_id ? { actionId: input.action_id } : {})
    };
    const data = {
      title_id: titleId,
      url: client.dashboardUrl(input.kind, linkInput)
    };
    return toolSuccess({
      title: "Glitch dashboard link",
      summary: "Open this link in a browser signed into Glitch for the full interactive experience.",
      data,
      links: [{ name: "Open Glitch", url: String(data.url) }]
    });
  }),

  defineTool("glitch_get_hosting", "Get Game Hosting", "Get the title's hosting account, bandwidth usage, sites, releases, domains, databases, and current pricing catalog.", hostingDashboardInput, true, async (client, input) => {
    const titleId = client.resolveTitleId(input.title_id);
    const data = await client.hostingDashboard(titleId);
    return toolSuccess({
      title: "Glitch game hosting",
      summary: "Hosting account and website state for this title.",
      data,
      links: [{ name: "Open Hosting", url: client.dashboardUrl("hosting", { titleId }) }]
    });
  }),

  defineTool("glitch_get_hosting_analytics", "Get Hosting Analytics", "Get hosted-website traffic, player, bandwidth, Store, and combined channel analytics without mixing Hosting revenue with Store distribution revenue.", hostingAnalyticsInput, true, async (client, input) => {
    const titleId = client.resolveTitleId(input.title_id);
    const data = await client.hostingChannelAnalytics(titleId, omitUndefined({
      start_date: input.start_date,
      end_date: input.end_date
    }));
    return toolSuccess({
      title: "Glitch Hosting analytics",
      summary: "Hosting and Store channels are reported separately, with a combined title view where available.",
      data,
      links: [{ name: "Open Hosting", url: client.dashboardUrl("hosting", { titleId }) }]
    });
  }),

  defineTool("glitch_create_hosting_site", "Create Hosting Site", "Create a managed game website with a free Glitch address. This is separate from Store distribution.", createHostingSiteInput, false, async (client, input) => {
    requireConfirmation(input.confirm, "Creating a Glitch-hosted game website");
    const titleId = client.resolveTitleId(input.title_id);
    const data = await client.createHostingSite(titleId, omitUndefined({
      name: input.name,
      slug: input.slug,
      mode: input.mode,
      azure_region: input.azure_region
    }));
    return toolSuccess({
      title: "Hosting site created",
      summary: `Created ${input.slug} as a ${input.mode} hosting site.`,
      data,
      links: [{ name: "Open Hosting", url: client.dashboardUrl("hosting", { titleId }) }]
    });
  }),

  defineTool("glitch_update_hosting_site", "Update Hosting Site", "Update a hosting site's name, static/server mode, player region, or non-secret runtime settings. Secret-shaped settings are blocked from MCP.", updateHostingSiteInput, false, async (client, input) => {
    requireConfirmation(input.confirm, "Updating the hosted game website");
    if (input.configuration) {
      assertSafeHostingConfiguration(input.configuration);
    }
    const titleId = client.resolveTitleId(input.title_id);
    const data = await client.updateHostingSite(titleId, input.site_id, omitUndefined({
      name: input.name,
      mode: input.mode,
      azure_region: input.azure_region,
      configuration: input.configuration
    }));
    return toolSuccess({
      title: "Hosting site updated",
      summary: `Updated hosting site ${input.site_id}.`,
      data,
      links: [{ name: "Open Hosting", url: client.dashboardUrl("hosting", { titleId }) }]
    });
  }),

  defineTool("glitch_list_hosting_releases", "List Hosting Releases", "List immutable Hosting releases for a website so a developer can inspect deployment state or choose a rollback target.", listHostingReleasesInput, true, async (client, input) => {
    const titleId = client.resolveTitleId(input.title_id);
    const data = await client.hostingReleases(titleId, input.site_id, { per_page: input.per_page });
    return toolSuccess({
      title: "Hosting releases",
      summary: `Releases for hosting site ${input.site_id}.`,
      data,
      links: [{ name: "Open Hosting", url: client.dashboardUrl("hosting", { titleId }) }]
    });
  }),

  defineTool("glitch_deploy_hosting_build", "Deploy Build To Game Hosting", "Turn a ready Glitch game build into an independent hosted website release. It can select the only existing site, create a site when none exists, wait for build and release processing, and publish the result. Call glitch_list_deployments first and upload a local ZIP only when no compatible build exists.", deployHostingBuildInput, false, async (client, input, ctx) => {
    requireConfirmation(input.confirm, input.publish ? "Deploying and publishing a hosted game website" : "Creating a hosted game website release");
    const titleId = client.resolveTitleId(input.title_id);

    await ctx?.log?.("info", `Waiting for game build ${input.game_build_id} to be ready.`);
    const build = await client.waitForDeploymentReady(titleId, input.game_build_id, input.timeout_ms, input.poll_interval_ms);
    const dashboard = await client.hostingDashboard(titleId);
    const sites = toArray(dashboard.sites).map(toRecord).filter((site): site is JsonObject => site !== undefined);
    let siteId = input.site_id;
    let site: JsonObject | undefined = siteId ? sites.find((candidate) => String(candidate.id || "") === siteId) : undefined;

    if (!siteId) {
      if (sites.length === 1) {
        const onlySite = sites[0];
        if (!onlySite) {
          throw new GlitchMcpError("upstream_error", "Glitch returned an invalid hosting site record.");
        }
        site = onlySite;
        siteId = String(onlySite.id || "");
      } else if (sites.length > 1) {
        throw new GlitchMcpError("validation_error", "This title has multiple hosting sites. Pass site_id so Glitch does not publish to the wrong website.");
      } else {
        if (!input.site_name || !input.site_slug) {
          throw new GlitchMcpError("validation_error", "No hosting site exists. Pass site_name and site_slug so Glitch can create one.");
        }
        const inferredMode = String(build.deployment_type || "").toLowerCase() === "node" ? "server" : "static";
        site = await client.createHostingSite(titleId, omitUndefined({
          name: input.site_name,
          slug: input.site_slug,
          mode: input.site_mode || inferredMode,
          azure_region: input.azure_region
        }));
        siteId = String(site.id || "");
      }
    }

    if (!siteId) {
      throw new GlitchMcpError("upstream_error", "Glitch did not return a hosting site id.");
    }

    await ctx?.log?.("info", `Creating hosting release ${input.version}.`);
    const queuedRelease = await client.createHostingRelease(titleId, siteId, {
      version: input.version,
      source_type: "game_build",
      game_build_id: input.game_build_id,
      entry_point: input.entry_point
    });
    const releaseId = String(queuedRelease.id || "");
    if (!releaseId) {
      throw new GlitchMcpError("upstream_error", "Glitch did not return a hosting release id.");
    }

    const readyRelease = await client.waitForHostingReleaseReady(titleId, siteId, releaseId, input.timeout_ms, input.poll_interval_ms);
    await ctx?.progress?.(1, input.publish ? 2 : 1, "Hosting release is ready");

    if (!input.publish) {
      return toolSuccess({
        title: "Hosting release ready",
        summary: `Prepared hosting release ${releaseId} without changing the live website.`,
        data: { site: site || { id: siteId }, build, release: readyRelease },
        links: [{ name: "Open Hosting", url: client.dashboardUrl("hosting", { titleId }) }]
      });
    }

    const publishedSite = await client.promoteHostingRelease(titleId, siteId, releaseId);
    await ctx?.progress?.(2, 2, "Hosted website published");
    return toolSuccess({
      title: "Hosted game published",
      summary: `Published hosting release ${releaseId}. Store distribution remains independent.`,
      data: { site: publishedSite, build, release: readyRelease },
      links: [
        { name: "Open hosted game", url: String(publishedSite.url || `https://${publishedSite.generated_hostname || ""}`) },
        { name: "Open Hosting", url: client.dashboardUrl("hosting", { titleId }) }
      ]
    });
  }),

  defineTool("glitch_promote_hosting_release", "Publish Or Roll Back Hosting Release", "Publish a ready hosting release or roll the website back to an earlier immutable release without changing Store distribution.", promoteHostingReleaseInput, false, async (client, input) => {
    requireConfirmation(input.confirm, "Changing the live hosted website release");
    const titleId = client.resolveTitleId(input.title_id);
    const data = await client.promoteHostingRelease(titleId, input.site_id, input.release_id);
    return toolSuccess({
      title: "Hosted release published",
      summary: `Hosting site ${input.site_id} now uses release ${input.release_id}.`,
      data,
      links: [
        { name: "Open hosted game", url: String(data.url || `https://${data.generated_hostname || ""}`) },
        { name: "Open Hosting", url: client.dashboardUrl("hosting", { titleId }) }
      ]
    });
  }),

  defineTool("glitch_connect_hosting_domain", "Connect Hosting Domain", "Connect a domain the developer already owns. Glitch returns the public DNS records needed for ownership verification.", connectHostingDomainInput, false, async (client, input) => {
    requireConfirmation(input.confirm, "Connecting a custom domain to the hosted game website");
    const titleId = client.resolveTitleId(input.title_id);
    const data = await client.connectHostingDomain(titleId, input.site_id, input.hostname);
    return toolSuccess({
      title: "Hosting domain connected",
      summary: `Add the returned DNS records for ${input.hostname}, then use glitch_verify_hosting_domain.`,
      data,
      links: [{ name: "Open Hosting", url: client.dashboardUrl("hosting", { titleId }) }]
    });
  }),

  defineTool("glitch_verify_hosting_domain", "Verify Hosting Domain", "Check public DNS and activate a connected custom domain when the verification and routing records are present.", verifyHostingDomainInput, false, async (client, input) => {
    requireConfirmation(input.confirm, "Verifying and activating a custom Hosting domain");
    const titleId = client.resolveTitleId(input.title_id);
    const data = await client.verifyHostingDomain(titleId, input.site_id, input.domain_id);
    return toolSuccess({
      title: "Hosting domain verification",
      summary: "Glitch checked public DNS and returned the domain's current activation state.",
      data,
      links: [{ name: "Open Hosting", url: client.dashboardUrl("hosting", { titleId }) }]
    });
  }),

  defineTool("glitch_check_hosting_domain", "Check Domain Availability", "Check whether Glitch can register a domain and return the live annual price and legal agreement keys. This does not purchase anything.", checkHostingDomainInput, true, async (client, input) => {
    const titleId = client.resolveTitleId(input.title_id);
    const data = await client.checkHostingDomainAvailability(titleId, input.hostname);
    return toolSuccess({
      title: "Hosting domain availability",
      summary: "Review availability, annual price, and every agreement before requesting a purchase.",
      data,
      links: [{ name: "Open Hosting", url: client.dashboardUrl("hosting", { titleId }) }]
    });
  }),

  defineTool("glitch_purchase_hosting_domain", "Purchase Hosting Domain", "Create secure checkout for a Glitch-managed domain only after the registrant accepts current agreements and confirms the exact annual price. Registration begins after paid checkout confirmation.", purchaseHostingDomainInput, false, async (client, input) => {
    requireConfirmation(input.confirm, "Starting paid domain registration Checkout");
    if (!input.accepted_legal_terms) {
      throw confirmationRequiredError("Accepting the current domain registration agreements");
    }
    requireExactConfirmation(
      input.billing_confirmation,
      `PURCHASE DOMAIN ${input.hostname.toLowerCase()} AT ${input.expected_annual_price_cents} CENTS PER YEAR`,
      "domain purchase"
    );
    const titleId = client.resolveTitleId(input.title_id);
    const data = await client.purchaseHostingDomain(titleId, input.site_id, {
      hostname: input.hostname,
      auto_renew: input.auto_renew,
      accepted_legal_terms: input.accepted_legal_terms,
      agreement_keys: input.agreement_keys,
      contact: input.contact,
      expected_annual_price_cents: input.expected_annual_price_cents,
      billing_confirmation: input.billing_confirmation,
      confirm: true
    });
    const checkoutUrl = readString(data.checkout_url);
    return toolSuccess({
      title: "Domain Checkout ready",
      summary: "The domain is not registered yet. Complete secure checkout, then confirm that checkout through Glitch.",
      data,
      links: [
        ...(checkoutUrl ? [{ name: "Open secure checkout", url: checkoutUrl }] : []),
        { name: "Open Hosting", url: client.dashboardUrl("hosting", { titleId }) }
      ]
    });
  }),

  defineTool("glitch_generate_hosting_ai_instructions", "Generate Hosting AI Instructions", "Create a safe copy-and-paste deployment guide for ChatGPT, Claude, Cursor, or Codex, including selected managed database add-ons without embedding credentials.", hostingAiInstructionsInput, true, async (client, input) => {
    const titleId = client.resolveTitleId(input.title_id);
    const data = await client.hostingAiInstructions(titleId, input.site_id, omitUndefined({
      framework: input.framework,
      custom_domain: input.custom_domain,
      databases: input.databases,
      preset: input.preset,
      version: input.version,
      services: input.services
    }));
    const instructions = readString(data.instructions);
    return toolSuccess({
      title: "Hosting AI instructions",
      summary: "Copy the generated guide into the coding assistant working on the game. It contains no passwords or private connection strings.",
      data,
      ...(instructions ? { bodyMarkdown: instructions } : {}),
      links: [{ name: "Open Hosting", url: client.dashboardUrl("hosting", { titleId }) }]
    });
  }),

  defineTool("glitch_list_hosting_services", "List Hosting Services", "List the public, private, singleton, replicated, worker, and scheduled services for a hosted game. Secret values are never returned.", listHostingServicesInput, true, async (client, input) => {
    const titleId = client.resolveTitleId(input.title_id);
    const data = await client.listHostingServices(titleId, input.site_id);
    return toolSuccess({
      title: "Hosting service stack",
      summary: `Current service topology for hosting site ${input.site_id}.`,
      data,
      links: [{ name: "Open Hosting", url: client.dashboardUrl("hosting", { titleId }) }]
    });
  }),

  defineTool("glitch_estimate_hosting_services", "Estimate Hosting Services", "Estimate the always-on CPU and memory floor for a service stack without creating resources or charges. Scale-out, requests, and jobs remain usage based.", estimateHostingServicesInput, true, async (client, input) => {
    const titleId = client.resolveTitleId(input.title_id);
    const data = await client.estimateHostingServices(titleId, input.site_id, omitUndefined({
      preset: input.preset,
      game_build_id: input.game_build_id,
      builds: input.builds,
      services: input.services
    }));
    return toolSuccess({
      title: "Hosting service estimate",
      summary: "Review the monthly floor and usage rates before deploying the stack.",
      data,
      links: [{ name: "Open Hosting", url: client.dashboardUrl("hosting", { titleId }) }]
    });
  }),

  defineTool("glitch_apply_hosting_services", "Deploy Hosting Services", "Queue an immutable multi-service Hosting release from a ready container build. Requires exact confirmation of the estimated monthly floor; publishing remains separate.", applyHostingServicesInput, false, async (client, input) => {
    requireConfirmation(input.confirm, "Deploying a metered Hosting service stack");
    requireExactConfirmation(
      input.billing_confirmation,
      `DEPLOY HOSTING STACK AT ESTIMATED FLOOR ${input.expected_monthly_floor_cents} CENTS PER MONTH PLUS USAGE`,
      "Hosting service deployment"
    );
    const titleId = client.resolveTitleId(input.title_id);
    const data = await client.applyHostingServices(titleId, input.site_id, omitUndefined({
      version: input.version,
      preset: input.preset,
      game_build_id: input.game_build_id,
      builds: input.builds,
      services: input.services,
      test: input.test,
      migration: input.migration,
      expected_monthly_floor_cents: input.expected_monthly_floor_cents,
      billing_confirmation: input.billing_confirmation,
      confirm: true
    }));
    return toolSuccess({
      title: "Hosting service deployment queued",
      summary: "Glitch is preparing private dependencies and public services as one immutable release. Publish only after the release is ready.",
      data,
      links: [{ name: "Open Hosting", url: client.dashboardUrl("hosting", { titleId }) }]
    });
  }),

  defineTool("glitch_list_hosting_databases", "List Hosting Databases", "List safe status, size, endpoint, port, and binding metadata for the title's managed databases. Passwords and connection strings are never returned; an authorized business owner may reveal them manually on the Hosting page.", listHostingDatabasesInput, true, async (client, input) => {
    const titleId = client.resolveTitleId(input.title_id);
    const data = await client.listHostingDatabases(titleId, input.site_id, { per_page: input.per_page });
    return toolSuccess({
      title: "Hosting databases",
      summary: `Database add-ons for hosting site ${input.site_id}.`,
      data,
      links: [{ name: "Open Hosting", url: client.dashboardUrl("hosting", { titleId }) }]
    });
  }),

  defineTool("glitch_get_hosting_database", "Get Hosting Database", "Get one database's safe status and connection metadata without returning its password, secret reference, or full connection string. Credential reveal is intentionally limited to the signed-in Hosting dashboard so secrets never enter model context.", getHostingDatabaseInput, true, async (client, input) => {
    const titleId = client.resolveTitleId(input.title_id);
    const data = await client.getHostingDatabase(titleId, input.site_id, input.database_id);
    return toolSuccess({
      title: "Hosting database",
      summary: `Safe database metadata for ${input.database_id}.`,
      data,
      links: [{ name: "Open Hosting", url: client.dashboardUrl("hosting", { titleId }) }]
    });
  }),

  defineTool("glitch_create_hosting_database", "Create Hosting Database", "Create secure checkout for a managed PostgreSQL, MySQL, SQL, NoSQL, or Redis add-on. Marketplace databases are not supported and setup waits for payment.", createHostingDatabaseInput, false, async (client, input) => {
    requireConfirmation(input.confirm, "Starting paid database Checkout");
    requireExactConfirmation(
      input.billing_confirmation,
      `CREATE DATABASE ${input.name.toUpperCase()} ON ${input.plan.toUpperCase()} AT ${input.expected_monthly_price_cents} CENTS PER MONTH`,
      "database creation"
    );
    const titleId = client.resolveTitleId(input.title_id);
    const data = await client.createHostingDatabase(titleId, input.site_id, {
      name: input.name,
      engine: input.engine,
      plan: input.plan,
      azure_region: input.azure_region,
      auto_grow_enabled: input.auto_grow_enabled,
      high_availability_enabled: input.high_availability_enabled,
      expected_monthly_price_cents: input.expected_monthly_price_cents,
      billing_confirmation: input.billing_confirmation,
      confirm: true
    });
    const checkoutUrl = readString(data.checkout_url);
    return toolSuccess({
      title: "Database Checkout ready",
      summary: "The database has not been created yet. Complete secure checkout, then confirm the checkout through Glitch.",
      data,
      links: [
        ...(checkoutUrl ? [{ name: "Open secure checkout", url: checkoutUrl }] : []),
        { name: "Open Hosting", url: client.dashboardUrl("hosting", { titleId }) }
      ]
    });
  }),

  defineTool("glitch_update_hosting_database", "Update Hosting Database", "Resize or change safeguards for an existing managed database. Exact current pricing is required, and size changes require explicit proration acceptance.", updateHostingDatabaseInput, false, async (client, input) => {
    requireConfirmation(input.confirm, "Changing a paid database");
    const titleId = client.resolveTitleId(input.title_id);
    const data = await client.updateHostingDatabase(titleId, input.site_id, input.database_id, omitUndefined({
      plan: input.plan,
      auto_grow_enabled: input.auto_grow_enabled,
      high_availability_enabled: input.high_availability_enabled,
      expected_monthly_price_cents: input.expected_monthly_price_cents,
      billing_confirmation: input.billing_confirmation,
      accept_proration: input.accept_proration,
      confirm: true
    }));
    return toolSuccess({
      title: "Hosting database update accepted",
      summary: "Glitch applied the billing guardrails and returned the database's current operation state.",
      data,
      links: [{ name: "Open Hosting", url: client.dashboardUrl("hosting", { titleId }) }]
    });
  }),

  defineTool("glitch_retry_hosting_database", "Retry Hosting Database", "Retry a failed database operation. If payment was never completed, Glitch returns a new secure checkout instead of creating an unpaid database.", retryHostingDatabaseInput, false, async (client, input) => {
    requireConfirmation(input.confirm, "Retrying a paid database operation");
    const titleId = client.resolveTitleId(input.title_id);
    const data = await client.retryHostingDatabase(titleId, input.site_id, input.database_id, {
      expected_monthly_price_cents: input.expected_monthly_price_cents,
      billing_confirmation: input.billing_confirmation,
      confirm: true
    });
    const checkoutUrl = readString(data.checkout_url);
    return toolSuccess({
      title: "Hosting database retry accepted",
      summary: checkoutUrl ? "Complete the replacement secure checkout before database setup can resume." : "Database setup was queued again.",
      data,
      links: [
        ...(checkoutUrl ? [{ name: "Open secure checkout", url: checkoutUrl }] : []),
        { name: "Open Hosting", url: client.dashboardUrl("hosting", { titleId }) }
      ]
    });
  }),

  defineTool("glitch_delete_hosting_database", "Delete Hosting Database", "Permanently delete a managed database and finalize its billing. Requires both confirm=true and the exact database name.", deleteHostingDatabaseInput, false, async (client, input) => {
    requireConfirmation(input.confirm, "Permanently deleting the database");
    const titleId = client.resolveTitleId(input.title_id);
    const data = await client.deleteHostingDatabase(titleId, input.site_id, input.database_id, input.confirmation);
    return toolSuccess({
      title: "Hosting database deletion queued",
      summary: `Deletion was accepted for database ${input.confirmation}.`,
      data,
      links: [{ name: "Open Hosting", url: client.dashboardUrl("hosting", { titleId }) }]
    });
  }),

  defineTool("glitch_change_hosting_plan", "Change Hosting Plan", "Start direct Checkout, request a Microsoft Marketplace change, or open the required AWS Marketplace subscription change for the title's bandwidth-based Hosting plan. AWS Marketplace has paid plans only. Hosting is separate from Store distribution.", changeHostingPlanInput, false, async (client, input) => {
    requireConfirmation(input.confirm, "Changing the paid Glitch Hosting plan");
    requireExactConfirmation(
      input.billing_confirmation,
      `CHANGE HOSTING PLAN TO ${input.plan.toUpperCase()} AT ${input.expected_monthly_price_cents} CENTS PER MONTH`,
      "Hosting plan change"
    );
    const titleId = client.resolveTitleId(input.title_id);
    const data = await client.changeHostingPlan(titleId, {
      plan: input.plan,
      expected_monthly_price_cents: input.expected_monthly_price_cents,
      billing_confirmation: input.billing_confirmation,
      accept_proration: input.accept_proration,
      confirm: true
    });
    const checkoutUrl = readString(data.checkout_url);
    const manageUrl = readString(data.manage_url);
    const provider = readString(data.billing_provider);
    return toolSuccess({
      title: checkoutUrl ? "Hosting plan Checkout ready" : manageUrl ? "AWS Marketplace plan change ready" : "Hosting plan updated",
      summary: checkoutUrl
        ? "Complete secure Checkout, then confirm it through Glitch."
        : provider === "microsoft_marketplace"
          ? "Microsoft Marketplace is processing the Hosting plan change."
          : provider === "aws_marketplace"
            ? "Finish the paid plan change in AWS Marketplace. Glitch will apply it after AWS confirms the entitlement."
            : "Glitch applied the Hosting plan change.",
      data,
      links: [
        ...(checkoutUrl ? [{ name: "Open secure Checkout", url: checkoutUrl }] : []),
        ...(manageUrl ? [{ name: "Manage AWS Marketplace subscription", url: manageUrl }] : []),
        { name: "Open Hosting", url: client.dashboardUrl("hosting", { titleId }) }
      ]
    });
  }),

  defineTool("glitch_confirm_hosting_checkout", "Confirm Hosting Checkout", "Ask Glitch to verify a completed Hosting, database, or domain checkout. Setup starts only after the payment provider reports paid or no payment required.", confirmHostingCheckoutInput, false, async (client, input) => {
    requireConfirmation(input.confirm, "Confirming checkout payment and starting setup");
    const titleId = client.resolveTitleId(input.title_id);
    const data = await client.confirmHostingCheckout(titleId, input.checkout_session_id);
    return toolSuccess({
      title: "Hosting Checkout confirmed",
      summary: "Glitch verified the checkout with the payment provider and returned the resulting Hosting operation.",
      data,
      links: [{ name: "Open Hosting", url: client.dashboardUrl("hosting", { titleId }) }]
    });
  }),

  /* ------------------------------------------------------------------ */
  /* Game services: multiplayer, cloud save, leaderboards, achievements, */
  /* and deployments. These operate the game associated with the current */
  /* title token (title_or_jwt public API), so the agent can run live     */
  /* game-backend actions, not just the agent/run surface.                */
  /* ------------------------------------------------------------------ */

  // --- Multiplayer ---
  defineTool(
    "glitch_list_multiplayer_lobbies",
    "List Multiplayer Lobbies",
    "List joinable multiplayer lobbies for the title's game, with optional region/mode/map/type filters.",
    z.object({ ...optionalTitleShape, region: z.string().optional(), game_mode: z.string().optional(), map_name: z.string().optional(), lobby_type: z.enum(["public", "invisible", "friends_only", "private"]).optional(), limit: z.number().int().min(1).max(100).optional() }),
    true,
    async (client, input) => {
      const titleId = client.resolveTitleId(input.title_id);
      const data = await client.listMultiplayerLobbies(titleId, omitUndefined({ region: input.region, game_mode: input.game_mode, map_name: input.map_name, lobby_type: input.lobby_type, limit: input.limit }));
      return toolSuccess({ title: "Multiplayer lobbies", summary: "Joinable lobbies for this title.", data, links: [{ name: "Open multiplayer", url: client.dashboardUrl("title", { titleId }) }] });
    }
  ),

  defineTool(
    "glitch_create_multiplayer_lobby",
    "Create Multiplayer Lobby",
    "Create a multiplayer lobby and insert the owner as the first member. player_id is required for title-token use.",
    z.object({ ...optionalTitleShape, player_id: z.string().min(1).max(128), display_name: z.string().max(128).optional(), max_members: z.number().int().min(1).max(250).optional(), region: z.string().optional(), game_mode: z.string().optional(), map_name: z.string().optional(), lobby_type: z.enum(["public", "invisible", "friends_only", "private"]).optional(), metadata: z.record(z.string(), z.unknown()).optional() }),
    false,
    async (client, input) => {
      const titleId = client.resolveTitleId(input.title_id);
      const data = await client.createMultiplayerLobby(titleId, omitUndefined({ player_id: input.player_id, display_name: input.display_name, max_members: input.max_members, region: input.region, game_mode: input.game_mode, map_name: input.map_name, lobby_type: input.lobby_type, metadata: input.metadata }));
      return toolSuccess({ title: "Multiplayer lobby created", summary: "The lobby was created with the owner as first member.", data, links: [{ name: "Open multiplayer", url: client.dashboardUrl("title", { titleId }) }] });
    }
  ),

  defineTool(
    "glitch_browse_multiplayer_servers",
    "Browse Multiplayer Servers",
    "Browse public, fresh, non-full dedicated servers registered to the title's game.",
    z.object({ ...optionalTitleShape, region: z.string().optional(), build_version: z.string().optional(), secure: z.boolean().optional(), limit: z.number().int().min(1).max(100).optional() }),
    true,
    async (client, input) => {
      const titleId = client.resolveTitleId(input.title_id);
      const data = await client.browseMultiplayerServers(titleId, omitUndefined({ region: input.region, build_version: input.build_version, secure: input.secure, limit: input.limit }));
      return toolSuccess({ title: "Multiplayer servers", summary: "Available servers in the browser.", data, links: [{ name: "Open multiplayer", url: client.dashboardUrl("title", { titleId }) }] });
    }
  ),

  defineTool(
    "glitch_list_multiplayer_realms",
    "List MMO Realms",
    "List MMO realms (persistent world shards) for the title's game, with optional region/status filters.",
    z.object({ ...optionalTitleShape, region: z.string().optional(), status: z.enum(["active", "locked", "maintenance", "full", "offline"]).optional(), limit: z.number().int().min(1).max(200).optional() }),
    true,
    async (client, input) => {
      const titleId = client.resolveTitleId(input.title_id);
      const data = await client.listMultiplayerRealms(titleId, omitUndefined({ region: input.region, status: input.status, limit: input.limit }));
      return toolSuccess({ title: "MMO realms", summary: "Realms (shards) for this title.", data, links: [{ name: "Open multiplayer", url: client.dashboardUrl("title", { titleId }) }] });
    }
  ),

  // --- Installs ---
  defineTool(
    "glitch_create_install",
    "Create Game Install",
    "Register a device install for the title's game. Returns the install id used by cloud save, leaderboards, and achievements.",
    z.object({ ...optionalTitleShape, platform: z.string().max(64).optional(), device_id: z.string().max(191).optional(), version: z.string().max(64).optional() }),
    false,
    async (client, input) => {
      const titleId = client.resolveTitleId(input.title_id);
      const data = await client.createInstall(titleId, omitUndefined({ platform: input.platform, device_id: input.device_id, version: input.version }));
      return toolSuccess({ title: "Install created", summary: "Persist the returned install id for later calls.", data, links: [{ name: "Open integration", url: client.dashboardUrl("title", { titleId }) }] });
    }
  ),

  defineTool(
    "glitch_validate_install",
    "Validate Game Install",
    "Validate an install at boot (entitlement + ownership check) for the title's game.",
    z.object({ ...optionalTitleShape, install_id: z.string().min(1).max(191) }),
    false,
    async (client, input) => {
      const titleId = client.resolveTitleId(input.title_id);
      const data = await client.validateInstall(titleId, input.install_id);
      return toolSuccess({ title: "Install validated", summary: "Validation result for the install.", data });
    }
  ),

  // --- Cloud save ---
  defineTool(
    "glitch_list_cloud_saves",
    "List Cloud Saves",
    "List cloud saves for a player install of the title's game.",
    z.object({ ...optionalTitleShape, install_id: z.string().min(1).max(191) }),
    true,
    async (client, input) => {
      const titleId = client.resolveTitleId(input.title_id);
      const data = await client.listCloudSaves(titleId, input.install_id);
      return toolSuccess({ title: "Cloud saves", summary: "Saves for this install.", data });
    }
  ),

  defineTool(
    "glitch_store_cloud_save",
    "Store Cloud Save",
    "Upload a cloud save for a player install. `payload` is the base64-encoded save bytes (<=10 MB decoded). `checksum` is the SHA-256 hex of the DECODED bytes — it is auto-computed if omitted (do not hash the base64 string). Send `base_version` (the version the client last synced from) for optimistic concurrency: a mismatch returns HTTP 409 with a conflict_id; resolve it with glitch_resolve_cloud_save_conflict.",
    z.object({
      ...optionalTitleShape,
      install_id: z.string().min(1).max(191),
      slot_index: z.number().int().min(0).max(99).describe("Save slot number (0-99)."),
      payload: z.string().min(1).describe("Base64-encoded save bytes (<=10 MB decoded)."),
      save_type: z.enum(["manual", "auto", "checkpoint", "quicksave"]).optional().describe("Defaults to manual."),
      client_timestamp: z.string().optional().describe("ISO 8601 time the save was taken on the client. Defaults to now."),
      base_version: z.number().int().min(0).optional().describe("Version the client edited from; omit for a brand-new slot."),
      checksum: z.string().max(64).optional().describe("SHA-256 hex of the decoded bytes. Auto-computed if omitted."),
      slot_name: z.string().max(100).optional(),
      metadata: z.record(z.string(), z.unknown()).optional()
    }),
    false,
    async (client, input) => {
      const titleId = client.resolveTitleId(input.title_id);
      const decoded = Buffer.from(input.payload, "base64");
      if (decoded.byteLength === 0) {
        throw new GlitchMcpError("validation_error", "payload did not decode to any bytes; send base64-encoded save data.");
      }
      const checksum = input.checksum ?? createHash("sha256").update(decoded).digest("hex");
      const data = await client.storeCloudSave(titleId, input.install_id, omitUndefined({
        slot_index: input.slot_index,
        payload: input.payload,
        checksum,
        save_type: input.save_type ?? "manual",
        client_timestamp: input.client_timestamp ?? new Date().toISOString(),
        base_version: input.base_version,
        slot_name: input.slot_name,
        metadata: input.metadata
      }));
      return toolSuccess({ title: "Cloud save stored", summary: "Save uploaded, or a 409 conflict was surfaced with a conflict_id to resolve.", data });
    }
  ),

  defineTool(
    "glitch_resolve_cloud_save_conflict",
    "Resolve Cloud Save Conflict",
    "After a 409 from glitch_store_cloud_save, resolve the conflict for a save slot: choice \"keep_server\" discards the client's changes, \"use_client\" overwrites the cloud with the client's data. Pass the conflict_id returned in the 409 response.",
    z.object({
      ...optionalTitleShape,
      install_id: z.string().min(1).max(191),
      save_id: z.string().min(1).max(191).describe("The save id from the 409 conflict response."),
      conflict_id: z.string().min(1).max(191).describe("The conflict_id from the 409 conflict response."),
      choice: z.enum(["keep_server", "use_client"])
    }),
    false,
    async (client, input) => {
      const titleId = client.resolveTitleId(input.title_id);
      const data = await client.resolveCloudSaveConflict(titleId, input.install_id, input.save_id, { conflict_id: input.conflict_id, choice: input.choice });
      return toolSuccess({ title: "Cloud save conflict resolved", summary: `Applied "${input.choice}" to save ${input.save_id}.`, data });
    }
  ),

  // --- Progression: leaderboards + achievements ---
  defineTool(
    "glitch_submit_progression",
    "Submit Progression Run",
    "Submit a progression run for a player install. `stats` (map of stat api_key -> number) drives stats AND achievement thresholds; `scores` (map of leaderboard api_key -> number) drives leaderboards. Use the exact api keys defined in the dashboard — unknown keys 404. Provide a unique `idempotency_key` so a retried run is counted once (a repeat returns status \"duplicate\"). Provide at least one of stats or scores. Returns newly-unlocked achievements and updated stats.",
    z.object({
      ...optionalTitleShape,
      install_id: z.string().min(1).max(191),
      idempotency_key: z.string().min(1).max(191).describe("Unique per run (e.g. a UUID). A repeat is treated as a duplicate so the run counts once."),
      stats: z.record(z.string(), z.number()).optional().describe("Map of stat api_key -> value. Drives stats and achievement unlocks."),
      scores: z.record(z.string(), z.number()).optional().describe("Map of leaderboard api_key -> score."),
      trust_level: z.enum(["unverified", "verified"]).optional().describe("Defaults to unverified."),
      platform: z.string().max(50).optional().describe("Defaults to web.")
    }),
    false,
    async (client, input) => {
      const titleId = client.resolveTitleId(input.title_id);
      const payload = omitUndefined({ stats: input.stats, scores: input.scores });
      if (Object.keys(payload).length === 0) {
        throw new GlitchMcpError("validation_error", "Provide at least one of `stats` or `scores`.");
      }
      const data = await client.submitProgression(titleId, input.install_id, omitUndefined({
        idempotency_key: input.idempotency_key,
        payload,
        trust_level: input.trust_level,
        platform: input.platform
      }));
      return toolSuccess({ title: "Progression submitted", summary: "Run submitted; stats, leaderboards, and achievements updated by the server.", data });
    }
  ),

  defineTool(
    "glitch_list_leaderboards",
    "List Leaderboard Definitions",
    "List the leaderboard definitions configured for the title's game.",
    z.object({ ...optionalTitleShape }),
    true,
    async (client, input) => {
      const titleId = client.resolveTitleId(input.title_id);
      const data = await client.listLeaderboardDefinitions(titleId);
      return toolSuccess({ title: "Leaderboard definitions", summary: "Configured leaderboards for this title.", data, links: [{ name: "Open leaderboards", url: client.dashboardUrl("title", { titleId }) }] });
    }
  ),

  defineTool(
    "glitch_read_leaderboard",
    "Read Leaderboard Standings",
    "Read the standings for a leaderboard by its api key.",
    z.object({ ...optionalTitleShape, api_key: z.string().min(1).max(191), limit: z.number().int().min(1).max(500).optional() }),
    true,
    async (client, input) => {
      const titleId = client.resolveTitleId(input.title_id);
      const data = await client.readLeaderboard(titleId, input.api_key, omitUndefined({ limit: input.limit }));
      return toolSuccess({ title: "Leaderboard standings", summary: `Standings for ${input.api_key}.`, data });
    }
  ),

  defineTool(
    "glitch_list_achievement_definitions",
    "List Achievement Definitions",
    "List the achievement definitions configured for the title's game.",
    z.object({ ...optionalTitleShape }),
    true,
    async (client, input) => {
      const titleId = client.resolveTitleId(input.title_id);
      const data = await client.listAchievementDefinitions(titleId);
      return toolSuccess({ title: "Achievement definitions", summary: "Configured achievements for this title.", data, links: [{ name: "Open achievements", url: client.dashboardUrl("title", { titleId }) }] });
    }
  ),

  defineTool(
    "glitch_list_player_achievements",
    "List Player Achievements",
    "List a player's unlocked/in-progress achievements for a given install of the title's game.",
    z.object({ ...optionalTitleShape, install_id: z.string().min(1).max(191) }),
    true,
    async (client, input) => {
      const titleId = client.resolveTitleId(input.title_id);
      const data = await client.listPlayerAchievements(titleId, input.install_id);
      return toolSuccess({ title: "Player achievements", summary: "Achievement state for this install.", data });
    }
  ),

  // --- Deployments ---
  defineTool(
    "glitch_list_deployments",
    "List Game Deployments",
    "List the game build deployments for the title.",
    z.object({ ...optionalTitleShape }),
    true,
    async (client, input) => {
      const titleId = client.resolveTitleId(input.title_id);
      const data = await client.listDeployments(titleId);
      return toolSuccess({ title: "Game deployments", summary: "Builds/deployments for this title.", data, links: [{ name: "Open deploy", url: client.dashboardUrl("title", { titleId }) }] });
    }
  ),

  defineTool(
    "glitch_update_deployment_status",
    "Update Deployment Status",
    "Update a game build's deployment status (e.g. publish or roll back) for the title's game.",
    z.object({ ...optionalTitleShape, build_id: z.string().min(1).max(191), status: z.string().min(1).max(64) }),
    false,
    async (client, input) => {
      const titleId = client.resolveTitleId(input.title_id);
      const data = await client.updateDeploymentStatus(titleId, input.build_id, { status: input.status });
      return toolSuccess({ title: "Deployment status updated", summary: `Build ${input.build_id} set to ${input.status}.`, data, links: [{ name: "Open deploy", url: client.dashboardUrl("title", { titleId }) }] });
    }
  ),

  defineTool(
    "glitch_deploy_game_build",
    "Deploy Game Build",
    "Upload a packaged game build (.zip) to Glitch end to end and register the deployment: initiate the multipart upload, PUT each part to its pre-signed URL, complete it, and confirm the build. Provide file_path over the stdio transport (large builds are streamed part by part) or content_base64 over HTTP (small builds). Requires deploy-create rights (a deploy token or title-admin JWT). This creates a real deployment; ask the developer for version/build/deployment type if not given.",
    z.object({
      ...optionalTitleShape,
      file_path: z.string().max(1024).optional().describe("Local path to the packaged build .zip. stdio transport only; streamed part by part."),
      content_base64: z.string().optional().describe("Base64 of the build .zip for the HTTP transport (small builds). Requires file_name."),
      file_name: z.string().max(255).optional(),
      version_string: z.string().min(1).max(20).describe("Human build version, e.g. \"1.4.2\"."),
      build_type: z.enum(["production", "playtest", "demo"]),
      deployment_type: z.string().min(1).max(64).describe("Glitch deployment type, e.g. html5/webgl/windows/linux (must match a configured type)."),
      entry_point: z.string().max(500).optional().describe("Entry file for web builds. Defaults to index.html server-side."),
      ue_version: z.string().max(20).optional(),
      custom_variables: z.record(z.string(), z.unknown()).optional(),
      part_size_mb: z.number().int().min(5).max(100).optional().describe("Multipart chunk size in MB (S3 minimum 5). Default 10.")
    }),
    false,
    async (client, input, ctx) => {
      const titleId = client.resolveTitleId(input.title_id);
      const partSize = (input.part_size_mb ?? 10) * 1024 * 1024;
      const source = await openDeploySource(client, input);

      try {
        await ctx?.log?.("info", `Deploying ${source.fileName} (${(source.size / (1024 * 1024)).toFixed(1)} MB) to Glitch.`);
        const init = await client.initiateDeploymentUpload(titleId, {});
        const filePath = String(init.file_path || "");
        if (!filePath) {
          throw new GlitchMcpError("upstream_error", "The deployment initiate response did not include a file_path.");
        }

        if (init.is_local === true && typeof init.upload_url === "string") {
          // Local/dev fallback: a single pre-signed PUT of the whole object.
          const bytes = await source.readPart(0, source.size);
          await client.putDeploymentObject(init.upload_url, bytes);
        } else {
          const uploadId = String(init.upload_id || "");
          if (!uploadId) {
            throw new GlitchMcpError("upstream_error", "The deployment initiate response did not include an upload_id.");
          }
          const totalParts = Math.max(1, Math.ceil(source.size / partSize));
          const partNumbers = Array.from({ length: totalParts }, (_, i) => i + 1);
          const urlsResp = await client.getDeploymentPartUrls(titleId, { upload_id: uploadId, file_path: filePath, part_numbers: partNumbers });
          const urls = (urlsResp.urls || {}) as Record<string, string>;

          const parts: Array<{ PartNumber: number; ETag: string }> = [];
          for (let n = 1; n <= totalParts; n++) {
            const start = (n - 1) * partSize;
            const end = Math.min(start + partSize, source.size);
            const chunk = await source.readPart(start, end);
            const url = urls[String(n)];
            if (!url) {
              throw new GlitchMcpError("upstream_error", `The server did not return a pre-signed URL for part ${n}.`);
            }
            const etag = await client.uploadDeploymentPart(url, chunk);
            parts.push({ PartNumber: n, ETag: etag });
            await ctx?.progress?.(n, totalParts, `Uploaded part ${n}/${totalParts}`);
          }
          await client.completeDeploymentUpload(titleId, { upload_id: uploadId, file_path: filePath, parts });
        }

        const build = await client.confirmDeployment(titleId, omitUndefined({
          file_path: filePath,
          version_string: input.version_string,
          entry_point: input.entry_point,
          build_type: input.build_type,
          deployment_type: input.deployment_type,
          custom_variables: input.custom_variables,
          ue_version: input.ue_version
        }));

        return toolSuccess({
          title: "Game build deployed",
          summary: `Uploaded ${source.fileName} and registered a ${input.build_type}/${input.deployment_type} deployment (v${input.version_string}). Processing runs asynchronously.`,
          data: build,
          links: [{ name: "Open deploy", url: client.dashboardUrl("title", { titleId }) }]
        });
      } finally {
        await source.close();
      }
    }
  )
];

export function registerGlitchTools(server: McpServer, client: GlitchClient): void {
  for (const definition of glitchToolDefinitions) {
    server.registerTool(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: definition.inputSchema,
        annotations: {
          readOnlyHint: definition.readOnlyHint ?? false,
          destructiveHint: definition.destructiveHint ?? false,
          idempotentHint: definition.idempotentHint ?? false,
          openWorldHint: true
        },
        ...(definition.uiResourceUri ? { _meta: { "ui.resourceUri": definition.uiResourceUri } } : {})
      },
      async (input, extra) => safeTool(() => definition.handler(client, input as never, buildToolContext(extra, server)))
    );
  }
}

function buildToolContext(extra: unknown, server: McpServer): ToolRuntimeContext {
  const record = (extra ?? {}) as {
    signal?: AbortSignal;
    sendNotification?: (notification: unknown) => Promise<void>;
    _meta?: { progressToken?: string | number };
  };
  const send = typeof record.sendNotification === "function" ? record.sendNotification : undefined;
  const progressToken = record._meta?.progressToken;
  const canElicit = Boolean(server.server.getClientCapabilities()?.elicitation);

  return {
    ...(record.signal ? { signal: record.signal } : {}),
    streamingEnabled: Boolean(send),
    canElicit,
    async elicit(request) {
      if (!canElicit) {
        return { action: "unsupported" };
      }
      try {
        const result = await server.server.elicitInput({
          message: request.message,
          requestedSchema: request.requestedSchema
        });
        return result.content ? { action: result.action, content: result.content } : { action: result.action };
      } catch {
        // Client advertised elicitation but failed to handle it — let the caller fall back.
        return { action: "unsupported" };
      }
    },
    async log(level, message) {
      if (!send) {
        return;
      }
      try {
        await send({ method: "notifications/message", params: { level, logger: "glitch", data: message } });
      } catch {
        // Best-effort: never fail a tool call because a notification could not be sent.
      }
    },
    async progress(progress, total, message) {
      if (!send || progressToken === undefined) {
        return;
      }
      try {
        await send({
          method: "notifications/progress",
          params: {
            progressToken,
            progress,
            ...(total !== undefined ? { total } : {}),
            ...(message ? { message } : {})
          }
        });
      } catch {
        // Best-effort.
      }
    }
  };
}

function defineTool<Input extends RawShape>(
  name: string,
  title: string,
  description: string,
  schema: z.ZodObject<Input>,
  readOnlyHint: boolean,
  handler: (client: GlitchClient, input: z.output<z.ZodObject<Input>>, ctx?: ToolRuntimeContext) => Promise<CallToolResult>
): GlitchToolDefinition {
  return {
    name,
    title,
    description,
    inputSchema: schema.shape,
    readOnlyHint,
    destructiveHint: !readOnlyHint,
    idempotentHint: readOnlyHint,
    handler: async (client, rawInput, ctx) => handler(client, schema.parse(rawInput), ctx)
  };
}

function analyticsFamilyTool(
  name: string,
  title: string,
  family: z.infer<typeof analyticsFamilySchema>,
  description: string
): GlitchToolDefinition {
  return defineTool(name, title, description, analyticsFamilyInput, true, async (client, input) => {
    const titleId = client.resolveTitleId(input.title_id);
    const data = await client.analyticsQuery(titleId, omitUndefined({
      family,
      report_keys: input.report_keys,
      filters: input.filters,
      report_filters: input.report_filters,
      fail_fast: input.fail_fast
    }));
    return toolSuccess({
      title,
      summary: `Generated the ${family} analytics bundle from canonical Glitch report paths.`,
      data,
      bodyMarkdown: presentAnalytics(data),
      links: [{ name: "Open title analytics", url: client.dashboardUrl("title", { titleId }) }]
    });
  });
}

function requireConfirmation(confirmed: boolean, action: string): void {
  if (!confirmed) {
    throw confirmationRequiredError(action);
  }
}

function requireExactConfirmation(actual: string, expected: string, action: string): void {
  if (actual !== expected) {
    throw new GlitchMcpError(
      "validation_error",
      `The ${action} confirmation must exactly match: ${expected}`
    );
  }
}

const HOSTING_SECRET_KEY_PARTS = [
  "password",
  "passwd",
  "secret",
  "token",
  "credential",
  "privatekey",
  "signingkey",
  "apikey",
  "accesskey",
  "authorization",
  "connectionstring",
  "databaseurl",
  "clientsecret",
  "sharedaccesssignature"
];

const HOSTING_SECRET_VALUE_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:postgres(?:ql)?|mysql|sqlserver|mongodb(?:\+srv)?):\/\/[^/\s:@]+:[^@\s]+@|(?:AccountKey|SharedAccessSignature|ClientSecret)\s*=|Bearer\s+[A-Za-z0-9._~-]{12,}/i;

/**
 * Hosting configuration is visible to deployment automation and must contain
 * references or ordinary settings, never raw credentials. The backend also
 * keeps database secrets in managed bindings; this client-side guard prevents an MCP
 * model from accidentally copying a secret into a general configuration map.
 */
function assertSafeHostingConfiguration(configuration: JsonObject): void {
  let visited = 0;

  const visit = (value: unknown, path: string, depth: number): void => {
    visited += 1;
    if (visited > 250) {
      throw new GlitchMcpError("validation_error", "Hosting configuration is too large; keep it to 250 values or fewer.");
    }
    if (depth > 8) {
      throw new GlitchMcpError("validation_error", `Hosting configuration is nested too deeply at ${path}.`);
    }
    if (typeof value === "string") {
      if (value.length > 16_000) {
        throw new GlitchMcpError("validation_error", `Hosting configuration value ${path} is too long.`);
      }
      if (HOSTING_SECRET_VALUE_PATTERN.test(value)) {
        throw new GlitchMcpError(
          "validation_error",
          `Hosting configuration ${path} appears to contain a credential. Store secrets through Glitch managed bindings instead of MCP.`
        );
      }
      return;
    }
    if (Array.isArray(value)) {
      if (value.length > 100) {
        throw new GlitchMcpError("validation_error", `Hosting configuration array ${path} is too large.`);
      }
      value.forEach((entry, index) => visit(entry, `${path}[${index}]`, depth + 1));
      return;
    }
    const record = toRecord(value);
    if (!record) {
      return;
    }
    for (const [key, entry] of Object.entries(record)) {
      const normalizedKey = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
      if (HOSTING_SECRET_KEY_PARTS.some((part) => normalizedKey.includes(part))) {
        throw new GlitchMcpError(
          "validation_error",
          `Hosting configuration key ${path}.${key} looks secret-bearing. Use a Glitch managed binding reference instead.`
        );
      }
      visit(entry, `${path}.${key}`, depth + 1);
    }
  };

  visit(configuration, "configuration", 0);
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toRecord(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

function readString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

interface GuidanceOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
}

interface GuidanceElicitation {
  readonly message: string;
  readonly requestedSchema: ElicitSchema;
  readonly optionByValue: Map<string, GuidanceOption>;
}

/**
 * Turn an agent stop-gate (guidance request) into an MCP elicitation prompt.
 *
 * Options become a multiple-choice enum (with human-readable labels and the
 * agent's recommended option preselected). A guidance request without options
 * becomes a free-text prompt. A "notes" field is always offered for context.
 */
function buildGuidanceElicitation(guidance: JsonObject): GuidanceElicitation {
  const options = normalizeGuidanceOptions(guidance.options);
  const optionByValue = new Map<string, GuidanceOption>();
  for (const option of options) {
    optionByValue.set(option.value, option);
  }

  const messageLines: string[] = [];
  const question = readString(guidance.question) || "The agent needs your input to continue.";
  messageLines.push(question);
  const reason = readString(guidance.reason);
  if (reason) {
    messageLines.push("", reason);
  }
  const recommended = resolveRecommended(guidance.recommended_option, options);
  if (recommended) {
    messageLines.push("", `Agent's recommendation: ${recommended.label}`);
  }

  const answerProperty: ElicitProperty =
    options.length > 0
      ? {
          type: "string",
          title: "Your choice",
          description: "Select one option for the agent.",
          enum: options.map((option) => option.value),
          enumNames: options.map((option) => option.label),
          ...(recommended ? { default: recommended.value } : {})
        }
      : {
          type: "string",
          title: "Your answer",
          description: "Type your answer for the agent."
        };

  return {
    message: messageLines.join("\n"),
    requestedSchema: {
      type: "object",
      properties: {
        answer: answerProperty,
        notes: { type: "string", title: "Notes (optional)", description: "Any extra context for the agent." }
      },
      required: ["answer"]
    },
    optionByValue
  };
}

function normalizeGuidanceOptions(value: unknown): GuidanceOption[] {
  const options: GuidanceOption[] = [];
  for (const entry of toArray(value)) {
    if (typeof entry === "string" && entry.trim()) {
      options.push({ value: entry.trim(), label: entry.trim() });
      continue;
    }
    const record = toRecord(entry);
    if (!record) {
      continue;
    }
    const optValue = readString(record.value) || readString(record.id) || readString(record.key) || readString(record.label);
    const label = readString(record.label) || readString(record.title) || readString(record.name) || optValue;
    if (!optValue || !label) {
      continue;
    }
    const description = readString(record.description);
    options.push({ value: optValue, label, ...(description ? { description } : {}) });
  }
  return options;
}

function resolveRecommended(value: unknown, options: GuidanceOption[]): GuidanceOption | undefined {
  const record = toRecord(value);
  const candidate = record
    ? readString(record.value) || readString(record.id) || readString(record.label)
    : readString(value);
  if (!candidate) {
    return undefined;
  }
  return options.find((option) => option.value === candidate || option.label === candidate);
}

function presentGuidanceResolution(resolved: JsonObject[]): string {
  if (resolved.length === 0) {
    return "No guidance was resolved.";
  }
  const lines: string[] = [];
  for (const entry of resolved) {
    const status = readString(entry.status) || "unknown";
    if (status === "answered") {
      lines.push(`- ✓ ${readString(entry.guidance_id)}: answered with "${readString(entry.selected) || ""}"`);
    } else if (status === "decline" || status === "cancel") {
      lines.push(`- ↩ ${readString(entry.guidance_id)}: ${status === "decline" ? "declined" : "cancelled"} by user (left open)`);
    } else {
      lines.push(`- • ${readString(entry.guidance_id)}: ${status}`);
    }
  }
  return lines.join("\n");
}

function assertCanReadLocalFiles(client: GlitchClient, action: string): void {
  if (!client.canReadLocalFiles) {
    throw new GlitchMcpError(
      "validation_error",
      `Local file reads are disabled for this transport (HTTP). Use the stdio MCP adapter on the developer machine to ${action}.`
    );
  }
}

function presentSocialAssetSetup(result: {
  readonly project_root: string;
  readonly folders: readonly string[];
  readonly config_path?: string;
  readonly watch_config_path?: string;
  readonly created_or_verified: readonly string[];
}): string {
  const lines = [
    `Project root: ${result.project_root}`,
    "",
    "Social asset folders:",
    ...result.folders.map((folder) => `- ${folder}`)
  ];

  if (result.config_path) {
    lines.push("", `Config: ${result.config_path}`);
  }
  if (result.watch_config_path) {
    lines.push(`Watch config: ${result.watch_config_path}`);
  }

  lines.push("", "Next step: run glitch_scan_local_social_assets to review candidate screenshots, captures, trailers, and marketing exports. The local watcher is off until glitch_start_social_asset_watch is activated.");

  return lines.join("\n");
}

function presentSocialAssetWatch(result: {
  readonly project_root: string;
  readonly enabled: boolean;
  readonly interval_hours: number;
  readonly watch_config_path: string;
  readonly next_scan_at?: string;
  readonly scan?: {
    readonly candidates: readonly SocialAssetCandidate[];
    readonly manifest_path?: string;
  };
}): string {
  const lines = [
    `Project root: ${result.project_root}`,
    `Watcher: ${result.enabled ? "enabled" : "disabled"}`,
    `Config: ${result.watch_config_path}`
  ];

  if (result.enabled) {
    lines.push(`Interval: every ${result.interval_hours} hour(s)`);
  }
  if (result.next_scan_at) {
    lines.push(`Next scan: ${result.next_scan_at}`);
  }
  if (result.scan) {
    lines.push(`Latest scan: ${result.scan.candidates.length} candidate(s)${result.scan.manifest_path ? `, manifest ${result.scan.manifest_path}` : ""}`);
  }

  return lines.join("\n");
}

function presentSocialAssetScan(result: {
  readonly scanned_roots: readonly string[];
  readonly ignored_roots: readonly string[];
  readonly candidates: readonly SocialAssetCandidate[];
  readonly manifest_path?: string;
}): string {
  const lines = [
    `Scanned ${result.scanned_roots.length} folder(s). Found ${result.candidates.length} candidate(s).`
  ];

  if (result.manifest_path) {
    lines.push(`Manifest: ${result.manifest_path}`);
  }

  if (result.ignored_roots.length > 0) {
    lines.push("", "Missing or unreadable roots:", ...result.ignored_roots.map((root) => `- ${root}`));
  }

  if (result.candidates.length === 0) {
    lines.push("", "No upload candidates met the scan threshold.");
    return lines.join("\n");
  }

  lines.push("", "Candidates:");
  for (const candidate of result.candidates.slice(0, 25)) {
    const platforms = candidate.suggested_platforms.length > 0 ? ` platforms=${candidate.suggested_platforms.join(",")}` : "";
    lines.push(`- ${candidate.id} score=${candidate.score}${platforms} ${candidate.relative_path}`);
    lines.push(`  ${candidate.reasons.join("; ")}`);
  }

  if (result.candidates.length > 25) {
    lines.push(`- ... ${result.candidates.length - 25} more candidate(s) in the manifest.`);
  }

  lines.push("", "Upload reviewed picks with glitch_upload_social_asset_candidates using candidate_ids, or pass upload_all_candidates=true after explicit approval.");

  return lines.join("\n");
}

function presentSocialAssetUpload(uploaded: readonly JsonObject[]): string {
  if (uploaded.length === 0) {
    return "No social assets were uploaded.";
  }

  const lines = [
    "Uploaded Media assets:",
    ...uploaded.map((item) => {
      const fileName = readString(item.file_name) || readString(item.file_path) || "asset";
      const mimeType = readString(item.mime_type) || "media";
      const candidate = readString(item.candidate_id);
      return `- ${fileName} (${mimeType})${candidate ? ` candidate=${candidate}` : ""}`;
    }),
    "",
    "Glitch queued Media AI processing. After AI analysis completes, eligible uploads can become scheduler library TitleUpdates with platform-specific OpenAI copy."
  ];

  return lines.join("\n");
}

interface SocialAssetUploadSelection {
  readonly projectRoot: string;
  readonly filePath: string;
  readonly sha256: string;
  readonly candidate?: SocialAssetCandidate;
}

async function resolveSocialAssetUploadSelections(
  projectRootInput: string,
  input: {
    readonly candidateIds: readonly string[];
    readonly filePaths: readonly string[];
    readonly uploadAllCandidates: boolean;
  }
): Promise<SocialAssetUploadSelection[]> {
  const projectRoot = await resolveProjectRootForTool(projectRootInput);
  const selections: SocialAssetUploadSelection[] = [];

  if (input.uploadAllCandidates || input.candidateIds.length > 0) {
    const manifestCandidates = await readSocialAssetManifest(projectRoot);
    const byId = new Map(manifestCandidates.map((candidate) => [candidate.id, candidate]));
    const candidates = input.uploadAllCandidates
      ? manifestCandidates
      : input.candidateIds.map((id) => {
          const candidate = byId.get(id);
          if (!candidate) {
            throw new GlitchMcpError("validation_error", `Candidate "${id}" was not found in the latest social asset scan manifest.`);
          }
          return candidate;
        });

    for (const candidate of candidates) {
      const filePath = await resolveProjectFilePath(projectRoot, candidate.file_path);
      selections.push({
        projectRoot,
        filePath,
        sha256: candidate.sha256 || await hashLocalAssetFile(filePath),
        candidate
      });
    }
  }

  for (const filePathInput of input.filePaths) {
    const filePath = await resolveProjectFilePath(projectRoot, filePathInput);
    selections.push({ projectRoot, filePath, sha256: await hashLocalAssetFile(filePath) });
  }

  const unique = new Map<string, SocialAssetUploadSelection>();
  for (const selection of selections) {
    if (!unique.has(selection.sha256)) {
      unique.set(selection.sha256, selection);
    }
  }

  return [...unique.values()];
}

async function resolveProjectRootForTool(projectRootInput: string): Promise<string> {
  const absolute = isAbsolute(projectRootInput) ? projectRootInput : resolve(projectRootInput);
  let metadata;
  try {
    metadata = await stat(absolute);
  } catch {
    throw new GlitchMcpError("not_found", `Project root "${projectRootInput}" does not exist.`);
  }
  if (!metadata.isDirectory()) {
    throw new GlitchMcpError("validation_error", `Project root "${projectRootInput}" is not a directory.`);
  }
  return realpath(absolute);
}

async function resolveProjectFilePath(projectRoot: string, filePathInput: string): Promise<string> {
  const absolute = isAbsolute(filePathInput) ? filePathInput : resolve(projectRoot, filePathInput);
  let filePath: string;
  try {
    filePath = await realpath(absolute);
  } catch {
    throw new GlitchMcpError("not_found", `Could not read local social asset "${filePathInput}".`);
  }

  const pathFromRoot = relative(projectRoot, filePath);
  if (pathFromRoot.startsWith("..") || pathFromRoot.includes(`..${sep}`) || isAbsolute(pathFromRoot)) {
    throw new GlitchMcpError("validation_error", `Social asset "${filePathInput}" must be inside project_root.`);
  }

  return filePath;
}

async function loadUploadBytes(
  client: GlitchClient,
  input: { file_path?: string | undefined; content_base64?: string | undefined; file_name?: string | undefined }
): Promise<{ bytes: Uint8Array; fileName: string }> {
  if (input.file_path) {
    if (!client.canReadLocalFiles) {
      throw new GlitchMcpError(
        "validation_error",
        "Local file reads are disabled for this transport (HTTP). Send the file as content_base64 instead of file_path."
      );
    }

    await assertUploadPathAllowed(input.file_path, client.uploadAllowedRoots);

    let metadata;
    try {
      metadata = await stat(input.file_path);
    } catch {
      throw new GlitchMcpError("not_found", `Could not read a local file at "${input.file_path}".`);
    }
    if (!metadata.isFile()) {
      throw new GlitchMcpError("validation_error", `Upload path "${input.file_path}" is not a regular file.`);
    }
    if (metadata.size > MAX_UPLOAD_BYTES) {
      throw new GlitchMcpError(
        "validation_error",
        `File is ${(metadata.size / (1024 * 1024)).toFixed(1)} MB, which exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB limit.`
      );
    }

    let buffer: Buffer;
    try {
      buffer = await readFile(input.file_path);
    } catch {
      throw new GlitchMcpError("not_found", `Could not read a local file at "${input.file_path}".`);
    }
    return { bytes: new Uint8Array(buffer), fileName: input.file_name || basename(input.file_path) };
  }

  if (input.content_base64) {
    if (!input.file_name) {
      throw new GlitchMcpError("validation_error", "file_name is required when uploading content_base64.");
    }
    if (!isValidBase64(input.content_base64)) {
      throw new GlitchMcpError("validation_error", "content_base64 must be valid base64 without non-base64 characters.");
    }
    const buffer = Buffer.from(input.content_base64, "base64");
    if (buffer.byteLength === 0) {
      throw new GlitchMcpError("validation_error", "content_base64 did not decode to any bytes.");
    }
    return { bytes: new Uint8Array(buffer), fileName: input.file_name };
  }

  throw new GlitchMcpError("validation_error", "Provide either file_path (stdio) or content_base64.");
}

/** Upper bounds for the deploy tool: builds are bigger than social assets. */
const MAX_DEPLOY_FILE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB via streamed file_path
const MAX_DEPLOY_BASE64_BYTES = 96 * 1024 * 1024; // 96 MB decoded via content_base64 (held in memory)

interface DeploySource {
  readonly size: number;
  readonly fileName: string;
  readPart(start: number, end: number): Promise<Uint8Array>;
  close(): Promise<void>;
}

/**
 * Resolve a byte source for a build upload.
 *
 * file_path (stdio only) is opened as a FileHandle and read part-by-part so a
 * large build never has to sit fully in memory. content_base64 (any transport)
 * is decoded once and sliced. Transport gating and allowed-root checks mirror
 * loadUploadBytes so the deploy tool obeys the same local-file safety rules.
 */
async function openDeploySource(
  client: GlitchClient,
  input: { file_path?: string | undefined; content_base64?: string | undefined; file_name?: string | undefined }
): Promise<DeploySource> {
  if (input.file_path) {
    if (!client.canReadLocalFiles) {
      throw new GlitchMcpError(
        "validation_error",
        "Local file reads are disabled for this transport (HTTP). Send the build as content_base64, or run the stdio MCP adapter on the developer machine to deploy from a path."
      );
    }
    await assertUploadPathAllowed(input.file_path, client.uploadAllowedRoots);

    let metadata;
    try {
      metadata = await stat(input.file_path);
    } catch {
      throw new GlitchMcpError("not_found", `Could not read a local file at "${input.file_path}".`);
    }
    if (!metadata.isFile()) {
      throw new GlitchMcpError("validation_error", `Build path "${input.file_path}" is not a regular file.`);
    }
    if (metadata.size === 0) {
      throw new GlitchMcpError("validation_error", "The build file is empty.");
    }
    if (metadata.size > MAX_DEPLOY_FILE_BYTES) {
      throw new GlitchMcpError(
        "validation_error",
        `Build is ${(metadata.size / (1024 * 1024)).toFixed(0)} MB, which exceeds the ${MAX_DEPLOY_FILE_BYTES / (1024 * 1024 * 1024)} GB limit. Use the Glitch-Cli-Deploy tool for very large builds.`
      );
    }

    const handle = await open(input.file_path, "r");
    return {
      size: metadata.size,
      fileName: input.file_name || basename(input.file_path),
      async readPart(start: number, end: number): Promise<Uint8Array> {
        const length = end - start;
        const buffer = Buffer.allocUnsafe(length);
        let offset = 0;
        while (offset < length) {
          const { bytesRead } = await handle.read(buffer, offset, length - offset, start + offset);
          if (bytesRead === 0) break;
          offset += bytesRead;
        }
        return new Uint8Array(buffer.subarray(0, offset));
      },
      async close(): Promise<void> {
        await handle.close();
      }
    };
  }

  if (input.content_base64) {
    if (!input.file_name) {
      throw new GlitchMcpError("validation_error", "file_name is required when deploying content_base64.");
    }
    if (!isValidBase64(input.content_base64)) {
      throw new GlitchMcpError("validation_error", "content_base64 must be valid base64 without non-base64 characters.");
    }
    const buffer = Buffer.from(input.content_base64, "base64");
    if (buffer.byteLength === 0) {
      throw new GlitchMcpError("validation_error", "content_base64 did not decode to any bytes.");
    }
    if (buffer.byteLength > MAX_DEPLOY_BASE64_BYTES) {
      throw new GlitchMcpError(
        "validation_error",
        `Build is ${(buffer.byteLength / (1024 * 1024)).toFixed(0)} MB. Over the HTTP transport the limit is ${MAX_DEPLOY_BASE64_BYTES / (1024 * 1024)} MB; use file_path over stdio for larger builds.`
      );
    }
    const bytes = new Uint8Array(buffer);
    return {
      size: bytes.byteLength,
      fileName: input.file_name,
      async readPart(start: number, end: number): Promise<Uint8Array> {
        return bytes.subarray(start, end);
      },
      async close(): Promise<void> {
        /* nothing to release for an in-memory buffer */
      }
    };
  }

  throw new GlitchMcpError("validation_error", "Provide either file_path (stdio) or content_base64 to deploy a build.");
}

async function assertUploadPathAllowed(filePath: string, allowedRoots: readonly string[]): Promise<void> {
  if (allowedRoots.length === 0) {
    return;
  }

  let fileRealPath: string;
  try {
    fileRealPath = await realpath(filePath);
  } catch {
    throw new GlitchMcpError("not_found", `Could not read a local file at "${filePath}".`);
  }

  const allowed = await Promise.all(
    allowedRoots.map(async (root) => {
      try {
        const absoluteRoot = isAbsolute(root) ? root : resolve(root);
        const rootRealPath = await realpath(absoluteRoot);
        const pathFromRoot = relative(rootRealPath, fileRealPath);
        return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !pathFromRoot.includes(`..${sep}`) && !isAbsolute(pathFromRoot));
      } catch {
        return false;
      }
    })
  );

  if (!allowed.some(Boolean)) {
    throw new GlitchMcpError(
      "permission_denied",
      `Upload path "${filePath}" is outside GLITCH_MCP_UPLOAD_ALLOWED_ROOTS. Move it into an allowed workspace or update the allow-list.`
    );
  }
}

function isValidBase64(value: string): boolean {
  const normalized = value.replace(/\s/g, "");
  if (normalized.length === 0 || normalized.length % 4 === 1) {
    return false;
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    return false;
  }

  try {
    return Buffer.from(normalized, "base64").toString("base64").replace(/=+$/, "") === normalized.replace(/=+$/, "");
  } catch {
    return false;
  }
}

function genreDisplayName(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const genre = value as Record<string, unknown>;
  const name = genre.name ?? genre.description ?? genre.label;
  return typeof name === "string" && name.trim() ? name.trim() : undefined;
}

function presentGameDesignBlueprint(data: JsonObject): string {
  const lines: string[] = [];
  const gameName = textField(data, "gameName") || "Game";
  lines.push(`# ${gameName} — Mechanics and Core Loop Blueprint`);

  appendTextSection(lines, "Game descriptor", textField(data, "descriptor") || textField(data, "shortPitch"));
  appendTextSection(lines, "Core fantasy", textField(data, "coreFantasy"));

  const coreVerbs = stringArrayField(data, "coreVerbs");
  if (coreVerbs.length) {
    lines.push("", "## Core verbs", "", coreVerbs.join(" → "));
  }

  appendBlueprintItems(lines, "Design pillars", data.pillars, false);
  appendBlueprintItems(lines, "Mechanics", data.mechanics, false);
  appendBlueprintItems(lines, "Moment-to-moment core loop", data.coreLoop, true);

  const sessionLoop = stringArrayField(data, "sessionLoop");
  if (sessionLoop.length) {
    lines.push("", "## Session loop", "", ...sessionLoop.map((item, index) => `${index + 1}. ${item}`));
  }

  const coreTest = textField(data, "coreTest");
  if (coreTest) {
    lines.push("", "## Core playtest question", "", `> ${coreTest}`);
  }

  const scopeRules = stringArrayField(data, "scopeRules");
  if (scopeRules.length) {
    lines.push("", "## Scope rules", "", ...scopeRules.map((item) => `- ${item}`));
  }

  appendTextSection(lines, "Documentation update", textField(data, "documentationInstruction"));
  return lines.join("\n");
}

function appendTextSection(lines: string[], title: string, value: string | undefined): void {
  if (value) {
    lines.push("", `## ${title}`, "", value);
  }
}

function appendBlueprintItems(lines: string[], title: string, value: unknown, numbered: boolean): void {
  if (!Array.isArray(value)) {
    return;
  }

  const items = value.flatMap((item, index) => {
    if (typeof item !== "object" || item === null) {
      return [];
    }
    const record = item as Record<string, unknown>;
    const itemTitle = typeof record.title === "string" ? record.title.trim() : "";
    const description = typeof record.description === "string" ? record.description.trim() : "";
    if (!itemTitle && !description) {
      return [];
    }
    const prefix = numbered ? `${index + 1}.` : "-";
    return [`${prefix} **${itemTitle || `Step ${index + 1}`}:** ${description}`];
  });

  if (items.length) {
    lines.push("", `## ${title}`, "", ...items);
  }
}

function textField(data: JsonObject, key: string): string | undefined {
  const value = data[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArrayField(data: JsonObject, key: string): string[] {
  const value = data[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim())
    : [];
}

function omitUndefined(input: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}
