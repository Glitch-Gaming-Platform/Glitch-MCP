import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { GlitchMcpError, isGlitchMcpError } from "./errors.js";

export interface ToolSuccessOptions {
  readonly title: string;
  readonly summary?: string;
  readonly data?: Record<string, unknown>;
  readonly links?: ToolLink[];
  readonly uiResourceUri?: string;
  /**
   * Pre-rendered, human-readable markdown body shown in the tool's text content.
   *
   * Clients such as Codex, Cursor, and Claude Code render this text but rarely
   * surface raw structuredContent, so tools pass a presenter-built summary here
   * to give a dashboard-like result inline.
   */
  readonly bodyMarkdown?: string;
}

export interface ToolLink {
  readonly name: string;
  readonly url: string;
  readonly description?: string;
}

/**
 * Build a result that is useful in every MCP client.
 *
 * The text content is intentionally human-readable for terminal-style clients.
 * structuredContent carries the machine-readable payload for clients that can
 * render cards, tables, or MCP Apps widgets.
 */
export function toolSuccess(options: ToolSuccessOptions): CallToolResult {
  const structuredContent: Record<string, unknown> = {
    status: "ok",
    title: options.title,
    ...(options.summary ? { summary: options.summary } : {}),
    ...(options.data ? { data: options.data } : {}),
    ...(options.links ? { links: options.links } : {})
  };

  const content = [
    {
      type: "text" as const,
      text: renderMarkdown(options)
    },
    ...(options.links || []).map((link) => ({
      type: "resource_link" as const,
      uri: link.url,
      name: link.name,
      title: link.name,
      description: link.description,
      mimeType: "text/html"
    }))
  ];

  return {
    content,
    structuredContent,
    ...(options.uiResourceUri ? { _meta: { "ui.resourceUri": options.uiResourceUri } } : {})
  };
}

export function toolError(error: unknown): CallToolResult {
  const normalized = normalizeError(error);

  return {
    isError: true,
    content: [
      {
        type: "text",
        text: `Glitch MCP error: ${normalized.message}\n\nCode: ${normalized.code}`
      }
    ],
    structuredContent: {
      status: "error",
      code: normalized.code,
      message: normalized.message,
      details: normalized.details
    }
  };
}

export async function safeTool(handler: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await handler();
  } catch (error) {
    return toolError(error);
  }
}

function normalizeError(error: unknown): GlitchMcpError {
  if (isGlitchMcpError(error)) {
    return error;
  }

  return new GlitchMcpError("upstream_error", error instanceof Error ? error.message : "Unexpected MCP adapter error.");
}

function renderMarkdown(options: ToolSuccessOptions): string {
  const lines = [`## ${options.title}`];

  if (options.summary) {
    lines.push("", options.summary);
  }

  if (options.bodyMarkdown && options.bodyMarkdown.trim()) {
    lines.push("", options.bodyMarkdown.trim());
  }

  if (options.links?.length) {
    lines.push("", "Links:");
    for (const link of options.links) {
      lines.push(`- ${link.name}: ${link.url}`);
    }
  }

  if (options.data && !options.bodyMarkdown) {
    lines.push("", "Structured data is included in the MCP tool result.");
  }

  return lines.join("\n");
}
