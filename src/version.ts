/**
 * Package version used in MCP server metadata and outbound Glitch API headers.
 *
 * Keep this value in sync with package.json during releases. It is intentionally
 * duplicated instead of importing package.json so the compiled CLI stays simple
 * across Node.js ESM loader versions.
 */
export const GLITCH_MCP_VERSION = "0.1.2";
