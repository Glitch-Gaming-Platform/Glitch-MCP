import { GlitchMcpConfig } from "./config.js";

/**
 * Optional OAuth 2.0 Protected Resource Metadata (RFC 9728).
 *
 * OAuth is opt-in (GLITCH_MCP_OAUTH_ENABLED). When enabled, the HTTP server
 * advertises this metadata so MCP clients can discover the authorization server,
 * and challenges unauthenticated requests with a WWW-Authenticate header. Actual
 * token verification stays with the hosted Glitch service — this adapter only
 * forwards the bearer. When OAuth is disabled, plain bearer-token auth still works.
 */
export const PROTECTED_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource";

export interface ProtectedResourceMetadata {
  readonly resource: string;
  readonly authorization_servers: string[];
  readonly bearer_methods_supported: string[];
  readonly scopes_supported?: string[];
  readonly resource_documentation: string;
}

export function protectedResourceMetadata(config: GlitchMcpConfig, fallbackResourceUrl: string): ProtectedResourceMetadata {
  const base: ProtectedResourceMetadata = {
    resource: config.oauthResourceUrl || fallbackResourceUrl,
    authorization_servers: config.oauthIssuer ? [config.oauthIssuer] : [],
    bearer_methods_supported: ["header"],
    resource_documentation: "https://github.com/glitch/glitch-mcp/blob/main/docs/auth.md"
  };

  return config.oauthScopes && config.oauthScopes.length > 0
    ? { ...base, scopes_supported: config.oauthScopes }
    : base;
}

/** WWW-Authenticate value pointing clients at the protected-resource metadata. */
export function wwwAuthenticateHeader(metadataUrl: string): string {
  return `Bearer resource_metadata="${metadataUrl}"`;
}
