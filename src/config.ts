import { configurationError } from "./errors.js";

export interface GlitchMcpConfig {
  /**
   * Base URL for the paid Glitch MCP facade.
   *
   * The public MCP adapter calls this hosted service. Core planner/executor
   * logic, subscription checks, and title permissions stay server-side.
   */
  readonly apiBaseUrl: string;

  /** Optional bearer token for clients that cannot use OAuth. */
  readonly token?: string;

  /** Optional default title used when a tool call omits title_id. */
  readonly defaultTitleId?: string;

  /** Base URL for human-facing Glitch dashboard deep links. */
  readonly dashboardBaseUrl: string;

  /** HTTP request timeout for hosted Glitch calls. */
  readonly timeoutMs: number;

  /** Optional client label added to outbound headers for support/auditing. */
  readonly clientName: string;

  /**
   * Whether the glitch_upload_file tool may read files from the local disk.
   *
   * Tri-state: undefined means "use the transport default" (true for stdio on a
   * developer's machine, false for the shared HTTP server). Set
   * GLITCH_MCP_ALLOW_LOCAL_FILE_READS to override either way.
   */
  readonly allowLocalFileReads?: boolean;

  /**
   * Optional allow-list of directories for stdio file uploads.
   *
   * When set, glitch_upload_file only reads file_path values whose real path is
   * inside one of these roots. Leave unset to preserve the local stdio default.
   */
  readonly uploadAllowedRoots?: string[];

  /** Hostnames allowed for DNS-rebinding protection when bound to 0.0.0.0/::. */
  readonly allowedHosts?: string[];

  /** Optional edge rate limit for the HTTP server (requests/min/credential). 0/undefined disables. */
  readonly rateLimitPerMinute?: number;

  /** Optional OAuth resource-server discovery. Disabled by default; token auth still works. */
  readonly oauthEnabled?: boolean;

  /** OAuth authorization server (issuer) advertised in protected-resource metadata. */
  readonly oauthIssuer?: string;

  /** Canonical URL of this MCP resource server, advertised in metadata. */
  readonly oauthResourceUrl?: string;

  /** Scopes advertised in protected-resource metadata. */
  readonly oauthScopes?: string[];
}

const DEFAULT_API_BASE_URL = "https://api.glitch.fun/api";
const DEFAULT_DASHBOARD_BASE_URL = "https://app.glitch.fun";
const DEFAULT_TIMEOUT_MS = 30_000;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GlitchMcpConfig {
  const apiBaseUrl = normalizeBaseUrl(env.GLITCH_API_BASE_URL || env.GLITCH_MCP_URL || DEFAULT_API_BASE_URL);
  const dashboardBaseUrl = normalizeBaseUrl(env.GLITCH_DASHBOARD_URL || DEFAULT_DASHBOARD_BASE_URL);
  const timeoutMs = parsePositiveInteger(env.GLITCH_MCP_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, "GLITCH_MCP_TIMEOUT_MS");
  const rateLimitPerMinute = parseNonNegativeInteger(env.GLITCH_MCP_RATE_LIMIT_PER_MINUTE, 0, "GLITCH_MCP_RATE_LIMIT_PER_MINUTE");
  const oauthEnabled = parseBoolean(env.GLITCH_MCP_OAUTH_ENABLED, false);

  const config: GlitchMcpConfig = {
    apiBaseUrl,
    dashboardBaseUrl,
    timeoutMs,
    clientName: env.GLITCH_MCP_CLIENT_NAME || "glitch-mcp",
    rateLimitPerMinute,
    oauthEnabled
  };

  return withOptional(config, {
    token: optionalNonEmpty(env.GLITCH_API_TOKEN || env.GLITCH_MCP_TOKEN),
    defaultTitleId: optionalNonEmpty(env.GLITCH_TITLE_ID || env.GLITCH_MCP_DEFAULT_TITLE_ID),
    allowLocalFileReads: parseOptionalBoolean(env.GLITCH_MCP_ALLOW_LOCAL_FILE_READS),
    uploadAllowedRoots: parseList(env.GLITCH_MCP_UPLOAD_ALLOWED_ROOTS),
    allowedHosts: parseList(env.GLITCH_MCP_ALLOWED_HOSTS),
    oauthIssuer: optionalNonEmpty(env.GLITCH_MCP_OAUTH_ISSUER),
    oauthResourceUrl: optionalNonEmpty(env.GLITCH_MCP_OAUTH_RESOURCE_URL),
    oauthScopes: parseList(env.GLITCH_MCP_OAUTH_SCOPES)
  });
}

interface OptionalConfig {
  token: string | undefined;
  defaultTitleId: string | undefined;
  allowLocalFileReads: boolean | undefined;
  uploadAllowedRoots: string[] | undefined;
  allowedHosts: string[] | undefined;
  oauthIssuer: string | undefined;
  oauthResourceUrl: string | undefined;
  oauthScopes: string[] | undefined;
}

function withOptional(config: GlitchMcpConfig, optional: OptionalConfig): GlitchMcpConfig {
  return {
    ...config,
    ...(optional.token ? { token: optional.token } : {}),
    ...(optional.defaultTitleId ? { defaultTitleId: optional.defaultTitleId } : {}),
    ...(optional.allowLocalFileReads === undefined ? {} : { allowLocalFileReads: optional.allowLocalFileReads }),
    ...(optional.uploadAllowedRoots ? { uploadAllowedRoots: optional.uploadAllowedRoots } : {}),
    ...(optional.allowedHosts ? { allowedHosts: optional.allowedHosts } : {}),
    ...(optional.oauthIssuer ? { oauthIssuer: optional.oauthIssuer } : {}),
    ...(optional.oauthResourceUrl ? { oauthResourceUrl: optional.oauthResourceUrl } : {}),
    ...(optional.oauthScopes ? { oauthScopes: optional.oauthScopes } : {})
  };
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw configurationError("Base URL cannot be empty.");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw configurationError(`Invalid URL: ${trimmed}`);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw configurationError(`Unsupported URL protocol for ${trimmed}. Use http or https.`);
  }

  return parsed.toString().replace(/\/+$/, "");
}

function parsePositiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw configurationError(`${name} must be a positive integer.`);
  }

  return parsed;
}

function parseNonNegativeInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw configurationError(`${name} must be a non-negative integer.`);
  }

  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  const parsed = parseOptionalBoolean(value);
  return parsed === undefined ? fallback : parsed;
}

function parseOptionalBoolean(value: string | undefined): boolean | undefined {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) {
    return undefined;
  }
  if (["1", "true", "yes", "on"].includes(trimmed)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(trimmed)) {
    return false;
  }
  return undefined;
}

function parseList(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : undefined;
}

function optionalNonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
