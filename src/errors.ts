/**
 * Error codes returned by the public MCP adapter.
 *
 * These codes are stable developer-facing contract values. They intentionally
 * avoid exposing internal Glitch exception classes, SQL errors, provider names,
 * prompts, or implementation details.
 */
export type GlitchErrorCode =
  | "configuration_error"
  | "authentication_required"
  | "subscription_required"
  | "permission_denied"
  | "title_required"
  | "not_found"
  | "conflict"
  | "validation_error"
  | "rate_limited"
  | "upstream_timeout"
  | "upstream_error"
  | "confirmation_required";

export interface GlitchErrorDetails {
  readonly status?: number;
  readonly retryAfterSeconds?: number;
  readonly billingUrl?: string;
  readonly dashboardUrl?: string;
  readonly fieldErrors?: Record<string, unknown>;
}

/**
 * Sanitized error used at the MCP boundary.
 *
 * Never attach raw Response objects, request headers, Authorization values, or
 * private backend stack traces to this class. The message and details may be
 * shown directly to a developer's AI client.
 */
export class GlitchMcpError extends Error {
  readonly code: GlitchErrorCode;
  readonly details: GlitchErrorDetails;

  constructor(code: GlitchErrorCode, message: string, details: GlitchErrorDetails = {}) {
    super(message);
    this.name = "GlitchMcpError";
    this.code = code;
    this.details = details;
  }
}

export function isGlitchMcpError(error: unknown): error is GlitchMcpError {
  return error instanceof GlitchMcpError;
}

export function configurationError(message: string): GlitchMcpError {
  return new GlitchMcpError("configuration_error", message);
}

export function titleRequiredError(): GlitchMcpError {
  return new GlitchMcpError(
    "title_required",
    "A game title is required. Pass title_id, set GLITCH_TITLE_ID, or call glitch_select_title first."
  );
}

export function confirmationRequiredError(action: string): GlitchMcpError {
  return new GlitchMcpError(
    "confirmation_required",
    `${action} requires confirm=true so an AI client cannot accidentally perform a risky operation.`
  );
}
