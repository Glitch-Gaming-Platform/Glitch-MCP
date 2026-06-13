import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GLITCH_MCP_VERSION } from "./version.js";

export function registerGlitchResources(server: McpServer): void {
  server.registerResource(
    "glitch-mcp-capabilities",
    "glitch://mcp/capabilities",
    {
      title: "Glitch MCP Capabilities",
      description: "Public capability contract for the Glitch MCP adapter.",
      mimeType: "application/json"
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(
            {
              name: "Glitch MCP",
              version: GLITCH_MCP_VERSION,
              auth: ["oauth_remote_mcp", "title_mcp_access_key", "stdio_proxy_env_token"],
              rich_experience: ["structured_results", "dashboard_deep_links", "mcp_apps_progressive_enhancement"],
              safety: [
                "subscription_checked_server_side",
                "title_scoped_tokens",
                "confirm_true_for_approval_and_execution",
                "no_private_planner_or_prompt_export"
              ]
            },
            null,
            2
          )
        }
      ]
    })
  );

  server.registerResource(
    "glitch-mcp-security-model",
    "glitch://mcp/security",
    {
      title: "Glitch MCP Security Model",
      description: "Security and commercial-boundary guidance for Glitch MCP.",
      mimeType: "text/markdown"
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/markdown",
          text: [
            "# Glitch MCP Security Model",
            "",
            "- Glitch MCP is a public adapter, not the private Glitch Agent planner.",
            "- Tokens identify users, workspaces, titles, scopes, and subscription state.",
            "- Every hosted call re-checks subscription, credits, title permissions, and action risk.",
            "- Public clients receive reports, cards, links, and artifacts, not private prompts or database access.",
            "- Mutating tools require explicit confirmation and remain guarded by Glitch server policies."
          ].join("\n")
        }
      ]
    })
  );

  for (const widget of widgetResources()) {
    server.registerResource(
      widget.name,
      widget.uri,
      {
        title: widget.title,
        description: widget.description,
        mimeType: "text/html"
      },
      async (uri) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: "text/html",
            text: widget.html
          }
        ]
      })
    );
  }
}

interface WidgetResource {
  readonly name: string;
  readonly uri: string;
  readonly title: string;
  readonly description: string;
  readonly html: string;
}

function widgetResources(): WidgetResource[] {
  return [
    widget("glitch-run-status-widget", "ui://glitch/run-status.html", "Glitch Run Status", "Inline run status and dashboard handoff widget."),
    widget("glitch-report-dashboard-widget", "ui://glitch/report-dashboard.html", "Glitch Report Dashboard", "Inline final report summary widget."),
    widget("glitch-artifact-gallery-widget", "ui://glitch/artifact-gallery.html", "Glitch Artifact Gallery", "Inline artifact list widget."),
    widget("glitch-approval-queue-widget", "ui://glitch/approval-queue.html", "Glitch Approval Queue", "Inline action review widget."),
    widget("glitch-guidance-form-widget", "ui://glitch/guidance-form.html", "Glitch Guidance Form", "Inline guidance review widget.")
  ];
}

function widget(name: string, uri: string, title: string, description: string): WidgetResource {
  return {
    name,
    uri,
    title,
    description,
    html: baseWidgetHtml(title, description)
  };
}

function baseWidgetHtml(title: string, description: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; padding: 16px; background: Canvas; color: CanvasText; }
    .shell { border: 1px solid color-mix(in oklab, CanvasText 18%, transparent); border-radius: 8px; padding: 14px; }
    h1 { font-size: 16px; line-height: 1.25; margin: 0 0 8px; }
    p { font-size: 13px; line-height: 1.45; margin: 0 0 12px; }
    pre { white-space: pre-wrap; word-break: break-word; font-size: 12px; padding: 10px; border-radius: 6px; background: color-mix(in oklab, CanvasText 8%, transparent); }
    a { color: LinkText; }
  </style>
</head>
<body>
  <section class="shell">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(description)}</p>
    <p>This widget is a progressive MCP Apps enhancement. If your host does not pass tool output into inline widgets, use the dashboard links returned by the tool result.</p>
    <pre id="payload">Waiting for host-provided Glitch tool data...</pre>
  </section>
  <script>
    const payload = document.getElementById("payload");
    const openai = window.openai || window.mcp || null;
    const candidate = openai && (openai.toolOutput || openai.input || openai.state);
    if (candidate) {
      payload.textContent = JSON.stringify(candidate, null, 2);
    }
  </script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
