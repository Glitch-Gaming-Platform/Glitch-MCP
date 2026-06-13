import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { createServer } from "node:http";
import { GlitchMcpConfig } from "./config.js";
import { GlitchClient } from "./glitchClient.js";
import { GLITCH_SERVER_INSTRUCTIONS } from "./instructions.js";
import { PROTECTED_RESOURCE_METADATA_PATH, protectedResourceMetadata, wwwAuthenticateHeader } from "./oauth.js";
import { createFixedWindowRateLimiter } from "./rateLimit.js";
import { registerGlitchPrompts } from "./prompts.js";
import { registerGlitchResources } from "./resources.js";
import { registerGlitchTools } from "./tools.js";
import { GLITCH_MCP_VERSION } from "./version.js";

export interface CreateServerOptions {
  readonly config: GlitchMcpConfig;
  readonly client?: GlitchClient;
  /**
   * Per-request bearer token (HTTP transport). Forwarded to the hosted Glitch
   * service so a multi-tenant deployment authenticates as the caller, not as a
   * single shared operator token. Ignored when an explicit client is supplied.
   */
  readonly authToken?: string;

  /**
   * Whether the upload tool may read local file paths. stdio passes true (the
   * developer's own machine); HTTP passes false so it never reads the server's
   * filesystem from a tool argument. Ignored when an explicit client is supplied.
   */
  readonly localFileAccess?: boolean;
}

export function createGlitchMcpServer(options: CreateServerOptions): McpServer {
  const server = new McpServer(
    {
      name: "glitch-mcp",
      version: GLITCH_MCP_VERSION
    },
    {
      instructions: GLITCH_SERVER_INSTRUCTIONS,
      capabilities: {
        logging: {}
      }
    }
  );

  const client =
    options.client ||
    new GlitchClient(options.config, undefined, undefined, {
      ...(options.authToken ? { authToken: options.authToken } : {}),
      ...(options.localFileAccess === undefined ? {} : { allowLocalFileReads: options.localFileAccess })
    });
  registerGlitchTools(server, client);
  registerGlitchPrompts(server);
  registerGlitchResources(server);

  return server;
}

export async function runStdioServer(config: GlitchMcpConfig): Promise<void> {
  // stdio runs on the developer's own machine, so the upload tool may read local
  // files unless explicitly disabled via GLITCH_MCP_ALLOW_LOCAL_FILE_READS=false.
  const server = createGlitchMcpServer({ config, localFileAccess: config.allowLocalFileReads ?? true });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export interface HttpServerOptions {
  readonly config: GlitchMcpConfig;
  readonly port: number;
  readonly host: string;
}

/**
 * Local Streamable HTTP mode for development and enterprise self-hosted proxies.
 *
 * Stateless: every request builds a fresh server bound to the caller's bearer.
 * OAuth discovery is optional (GLITCH_MCP_OAUTH_ENABLED); when enabled the server
 * advertises protected-resource metadata and challenges unauthenticated requests,
 * while token verification stays with the hosted Glitch facade.
 */
export async function runHttpServer(options: HttpServerOptions): Promise<void> {
  const { config } = options;
  const app = createMcpExpressApp({
    host: options.host,
    ...(config.allowedHosts ? { allowedHosts: config.allowedHosts } : {})
  });

  const rateLimiter = createFixedWindowRateLimiter(config.rateLimitPerMinute ?? 0);
  const resourceUrl = config.oauthResourceUrl || `http://${options.host}:${options.port}/mcp`;
  const metadataUrl = `${trimTrailingSlash(originFromResource(resourceUrl))}${PROTECTED_RESOURCE_METADATA_PATH}`;

  if (config.oauthEnabled) {
    app.get(PROTECTED_RESOURCE_METADATA_PATH, (_req: any, res: any) => {
      res.json(protectedResourceMetadata(config, resourceUrl));
    });
  }

  app.post("/mcp", async (req: any, res: any) => {
    const authToken = bearerFromAuthorization(req.headers?.authorization);

    const limit = rateLimiter.check(authToken || clientIp(req));
    if (!limit.allowed) {
      res.setHeader("Retry-After", String(limit.retryAfterSeconds));
      res.status(429).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Rate limit exceeded. Retry later." },
        id: null
      });
      return;
    }

    // Optional OAuth challenge: only when OAuth is enabled AND no token was sent.
    if (config.oauthEnabled && !authToken) {
      res.setHeader("WWW-Authenticate", wwwAuthenticateHeader(metadataUrl));
      res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Authentication required. Authenticate via OAuth or send a bearer token." },
        id: null
      });
      return;
    }

    // HTTP runs on a shared host, so the upload tool must not read the server's
    // filesystem from a tool argument unless explicitly enabled.
    const server = createGlitchMcpServer({
      config,
      localFileAccess: config.allowLocalFileReads ?? false,
      ...(authToken ? { authToken } : {})
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined
    } as any);

    try {
      await server.connect(transport as any);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : "Internal Glitch MCP server error"
          },
          id: null
        });
      }
    } finally {
      await transport.close();
      await server.close();
    }
  });

  app.get("/mcp", (_req: any, res: any) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Use POST /mcp for stateless Streamable HTTP requests." },
      id: null
    });
  });

  app.get("/health", (_req: any, res: any) => {
    res.json({
      status: "ok",
      name: "glitch-mcp",
      version: GLITCH_MCP_VERSION,
      oauth_enabled: Boolean(config.oauthEnabled)
    });
  });

  await new Promise<void>((resolve, reject) => {
    const server = createServer(app);
    server.once("error", reject);
    server.listen(options.port, options.host, () => resolve());
  });
}

function clientIp(req: any): string {
  return String(req?.ip || req?.socket?.remoteAddress || "unknown");
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function originFromResource(resourceUrl: string): string {
  try {
    return new URL(resourceUrl).origin;
  } catch {
    return resourceUrl;
  }
}

/**
 * Extract a bearer token from an Authorization header value.
 *
 * Returns undefined for missing or non-bearer headers so the adapter can fall
 * back to the configured token (stdio) or report authentication_required.
 */
export function bearerFromAuthorization(header: unknown): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== "string") {
    return undefined;
  }

  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  const token = match?.[1]?.trim();
  return token ? token : undefined;
}
