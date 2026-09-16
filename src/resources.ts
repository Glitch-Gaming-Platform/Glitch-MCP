import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GlitchClient } from "./glitchClient.js";
import { MICROTRANSACTION_SETUP_GUIDE, sanitizeMicrotransactionResult } from "./microtransactionTools.js";
import {
  GAME_DEVELOPMENT_PROMPT_CATEGORIES,
  GAME_DEVELOPMENT_PROMPTS,
  GAME_DEVELOPMENT_PROMPT_PAGE_URL,
  gameDevelopmentPromptResourceUri,
  gameDevelopmentPromptUrl
} from "./gameDevelopmentPrompts.js";
import { GLITCH_MCP_VERSION } from "./version.js";
import { readFile } from "node:fs/promises";

export function registerGlitchResources(server: McpServer, client: GlitchClient): void {
  server.registerResource("glitch-commerce-delivery-receiver", "glitch://microtransactions/delivery-receiver", {
    title: "Ed25519 Commerce Delivery Receiver", mimeType: "text/javascript",
    description: "Complete Node24+ raw-body signature verifier and durable notification inbox: pinned public key/key ID, 300-second timestamp tolerance, event/title/environment checks, persistent dedupe, ack only after commit. Never applies embedded aggregate inventory snapshots; an authorized game/player refreshes current entitlements."
  }, async uri => ({ contents: [{ uri: uri.href, mimeType: "text/javascript", text: await readFile(new URL("../examples/commerce-delivery-receiver.mjs", import.meta.url), "utf8") }] }));
  server.registerResource("glitch-microtransaction-setup", "glitch://microtransactions/setup", {
    title: "Glitch Microtransaction Setup", mimeType: "text/markdown",
    description: "Complete direct commerce workflow: catalog, provider setup, current availability, refund/reconciliation/delivery operations, 12% economics, title abilities, white-label game handoff and sandbox checks. Authorized writes do not require a separate approval workflow."
  }, async uri => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: MICROTRANSACTION_SETUP_GUIDE }] }));

  server.registerResource("glitch-title-microtransaction-capabilities", new ResourceTemplate("glitch://titles/{title_id}/microtransactions/capabilities", { list: undefined }), {
    title: "Title Microtransaction Schemas", mimeType: "application/json",
    description: "Authoritative server JSON schemas, units, examples, abilities, mutation metadata and factual provider capabilities for this exact title; authenticated with the requesting MCP caller, never a shared operator or runtime install token."
  }, async (uri, variables) => {
    const titleId = variables.title_id;
    if (typeof titleId !== "string" || !/^[A-Za-z0-9_:-]{1,160}$/.test(titleId)) throw new Error("A valid title identifier is required.");
    const data = await client.microtransactionCapabilities(titleId);
    return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(sanitizeMicrotransactionResult(data), null, 2) }] };
  });
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
              rich_experience: ["structured_results", "dashboard_deep_links", "mcp_apps_progressive_enhancement", "long_running_generation_progress"],
              game_development: ["public_prompt_library", "live_genre_taxonomy", "multi_genre_mechanics_and_core_loop_blueprints", "documentation_required"],
              analytics: ["canonical_dashboard_reports", "dynamic_report_catalog", "family_bundles", "partial_results", "agent_shared_contract"],
              microtransactions: ["title_scoped_schema_discovery", "direct_authorized_management", "catalog_prices_grants", "existing_media_upload", "factual_provider_capabilities", "idempotent_refunds", "order_reconciliation", "game_white_label_checkout", "one_time_scoped_account_handoff", "sandbox_readiness", "immutable_delivery_replay"],
              social: ["dynamic_operation_catalog", "title_scoped_primitives", "agent_shared_registry", "platform_capability_matrix"],
              safety: [
                "subscription_checked_server_side",
                "title_scoped_tokens",
                "read_only_analytics_reports",
                "bounded_analytics_queries",
                "analytics_secrets_redacted",
                "non_commerce_confirmation_rules_preserved",
                "granular_social_abilities",
                "social_credentials_rejected_and_redacted",
                "no_private_planner_or_prompt_export",
                "public_editorial_game_development_prompts_only"
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
            "- Services re-check title permissions, resource scope and applicable billing policies. Direct commerce tools do not start a paid Agent run.",
            "- Public clients receive reports, cards, links, and artifacts, not private prompts or database access.",
            "- The AI Game Development Prompt library is intentionally public editorial guidance. It is separate from private Glitch Agent planner prompts and internal execution logic.",
            "- Analytics tools are read-only, title-scoped, bounded by report/date/page limits, and reuse the canonical dashboard calculations.",
            "- Social operations validate every resource against the selected title, reject credential-shaped input, and redact secrets recursively.",
            "- Authorized title-scoped commerce writes execute directly without a custom confirmation or human-review workflow; validation, immutable financial rules and actual provider capabilities remain enforced.",
            "- Non-commerce tools retain their separately documented confirmation and approval requirements."
          ].join("\n")
        }
      ]
    })
  );

  server.registerResource(
    "glitch-game-development-prompt-catalog",
    "glitch://game-development/prompts",
    {
      title: "Glitch AI Game Development Prompt Catalog",
      description: "Metadata and stable resource links for every public Glitch AI game-development prompt.",
      mimeType: "application/json"
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(
            {
              page_url: GAME_DEVELOPMENT_PROMPT_PAGE_URL,
              categories: GAME_DEVELOPMENT_PROMPT_CATEGORIES,
              prompts: GAME_DEVELOPMENT_PROMPTS.map((prompt) => ({
                id: prompt.id,
                category: prompt.category,
                eyebrow: prompt.eyebrow,
                title: prompt.title,
                description: prompt.description,
                best_for: prompt.bestFor,
                ...(prompt.warning ? { warning: prompt.warning } : {}),
                resource_uri: gameDevelopmentPromptResourceUri(prompt.id),
                url: gameDevelopmentPromptUrl(prompt.id)
              }))
            },
            null,
            2
          )
        }
      ]
    })
  );

  for (const prompt of GAME_DEVELOPMENT_PROMPTS) {
    server.registerResource(
      `glitch-game-development-prompt-${prompt.id}`,
      gameDevelopmentPromptResourceUri(prompt.id),
      {
        title: `AI Game Development Prompt: ${prompt.title}`,
        description: prompt.description,
        mimeType: "text/markdown"
      },
      async (uri) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: [
              `<!-- Glitch prompt id: ${prompt.id} -->`,
              `<!-- Category: ${prompt.category}; Best for: ${prompt.bestFor} -->`,
              ...(prompt.warning ? [`<!-- Warning: ${prompt.warning} -->`] : []),
              `<!-- Web: ${gameDevelopmentPromptUrl(prompt.id)} -->`,
              "",
              prompt.prompt
            ].join("\n")
          }
        ]
      })
    );
  }

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
