import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

const optionalTitleArgs = {
  title_id: z.string().optional().describe("Optional Glitch title id if one has not already been selected.")
};

export function registerGlitchPrompts(server: McpServer): void {
  server.registerPrompt(
    "glitch_launch_audit",
    {
      title: "Glitch Launch Audit",
      description: "Review a game title's launch readiness with the hosted Glitch Agent.",
      argsSchema: {
        ...optionalTitleArgs,
        focus: z.string().optional().describe("Optional launch focus, such as Steam, creators, TikTok, press, or Discord.")
      }
    },
    async ({ title_id, focus }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Use Glitch MCP to run a launch readiness audit.",
              title_id ? `Title id: ${title_id}` : "If no title is selected, list titles and ask me which title to use.",
              focus ? `Focus: ${focus}` : "Cover positioning, content, social, creator, community, and paid/media risks.",
              "Return the final report summary and link me to the Glitch dashboard for review."
            ].join("\n")
          }
        }
      ]
    })
  );

  server.registerPrompt(
    "glitch_steam_page_review",
    {
      title: "Glitch Steam Page Review",
      description: "Ask Glitch Agent to review Steam page performance and page improvement opportunities.",
      argsSchema: optionalTitleArgs
    },
    async ({ title_id }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Use Glitch MCP to review the Steam page and summarize store-page improvement opportunities.",
              title_id ? `Title id: ${title_id}` : "If no title is selected, list titles and ask me which title to use.",
              "Fetch the run report and include dashboard links for artifacts and next actions."
            ].join("\n")
          }
        }
      ]
    })
  );

  server.registerPrompt(
    "glitch_weekly_marketing_sync",
    {
      title: "Glitch Weekly Marketing Sync",
      description: "Generate a weekly game marketing plan and review pending Glitch actions.",
      argsSchema: optionalTitleArgs
    },
    async ({ title_id }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Use Glitch MCP to create a weekly marketing sync for this game title.",
              title_id ? `Title id: ${title_id}` : "If no title is selected, list titles and ask me which title to use.",
              "After the run finishes, list pending actions and guidance. Do not approve or execute actions without my explicit confirmation."
            ].join("\n")
          }
        }
      ]
    })
  );

  server.registerPrompt(
    "glitch_review_pending_actions",
    {
      title: "Glitch Review Pending Actions",
      description: "Review pending Glitch Agent approvals and guidance without executing them.",
      argsSchema: optionalTitleArgs
    },
    async ({ title_id }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Use Glitch MCP to list pending actions and open guidance for this title.",
              title_id ? `Title id: ${title_id}` : "If no title is selected, list titles and ask me which title to use.",
              "Summarize each item by risk, likely impact, required decision, and dashboard link. Do not approve or execute anything yet."
            ].join("\n")
          }
        }
      ]
    })
  );

  server.registerPrompt(
    "glitch_setup_local_social_assets",
    {
      title: "Glitch Setup Local Social Assets",
      description: "Create the local capture folders and scan manifest for development assets that can become social content.",
      argsSchema: {
        ...optionalTitleArgs,
        project_root: z.string().optional().describe("Local game project root on the machine running the stdio MCP.")
      }
    },
    async ({ title_id, project_root }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Use Glitch MCP to set up local social asset folders for this game project.",
              title_id ? `Title id: ${title_id}` : "If no title is selected, list titles and ask me which title to use.",
              project_root ? `Project root: ${project_root}` : "Use the current game project root if the client can provide it; otherwise ask me for the local project_root.",
              "Call glitch_setup_social_asset_folders with confirm=true, then call glitch_scan_local_social_assets.",
              "Summarize the scan candidates and do not upload anything until I explicitly approve which assets to send."
            ].join("\n")
          }
        }
      ]
    })
  );

  server.registerPrompt(
    "glitch_scan_local_social_assets",
    {
      title: "Glitch Scan Local Social Assets",
      description: "Scan existing local capture, screenshot, trailer, build social, and marketing folders for upload candidates.",
      argsSchema: {
        ...optionalTitleArgs,
        project_root: z.string().optional().describe("Local game project root on the machine running the stdio MCP."),
        since_hours: z.string().optional().describe("Optional lookback window, such as 24 or 168.")
      }
    },
    async ({ title_id, project_root, since_hours }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Use Glitch MCP to scan local game assets for social content candidates.",
              title_id ? `Title id: ${title_id}` : "If no title is selected, list titles and ask me which title to use.",
              project_root ? `Project root: ${project_root}` : "Use the current game project root if available; otherwise ask me for project_root.",
              since_hours ? `Only include files modified in the last ${since_hours} hours.` : "Use the default scan window and thresholds.",
              "Show candidate ids, scores, suggested platforms, and reasons. Do not upload anything yet."
            ].join("\n")
          }
        }
      ]
    })
  );

  server.registerPrompt(
    "glitch_upload_local_social_assets",
    {
      title: "Glitch Upload Local Social Assets",
      description: "Upload reviewed local social candidates as Glitch Media for AI processing and scheduler library creation.",
      argsSchema: {
        ...optionalTitleArgs,
        project_root: z.string().optional().describe("Local game project root on the machine running the stdio MCP."),
        candidate_ids: z.string().optional().describe("Comma-separated candidate ids from the latest scan manifest."),
        title_promotion_schedule_id: z.string().optional().describe("Required scheduler id that should receive generated TitleUpdates after Media AI processing.")
      }
    },
    async ({ title_id, project_root, candidate_ids, title_promotion_schedule_id }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Use Glitch MCP to upload reviewed local social assets as Media.",
              title_id ? `Title id: ${title_id}` : "If no title is selected, list titles and ask me which title to use.",
              project_root ? `Project root: ${project_root}` : "Use the current game project root if available; otherwise ask me for project_root.",
              candidate_ids ? `Candidate ids to upload: ${candidate_ids}` : "Use the latest scan manifest and ask me which candidate ids to upload.",
              title_promotion_schedule_id ? `Title promotion schedule id: ${title_promotion_schedule_id}` : "Ask me for the title_promotion_schedule_id before uploading assets that should create scheduler library TitleUpdates.",
              "Call glitch_upload_social_asset_candidates only after explicit approval and with confirm=true.",
              "These uploads should become Media first. After Media AI analysis completes, Glitch can create scheduler library TitleUpdates and use the existing OpenAIApiService social copy system for platform-specific text."
            ].join("\n")
          }
        }
      ]
    })
  );

  server.registerPrompt(
    "glitch_start_local_social_asset_watch",
    {
      title: "Glitch Start Local Social Watch",
      description: "Activate the opt-in local watcher that rescans social asset folders daily.",
      argsSchema: {
        ...optionalTitleArgs,
        project_root: z.string().optional().describe("Local game project root on the machine running the stdio MCP."),
        interval_hours: z.string().optional().describe("Optional scan interval in hours. Defaults to 24.")
      }
    },
    async ({ title_id, project_root, interval_hours }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Use Glitch MCP to activate the local social asset watcher for this game project.",
              title_id ? `Title id: ${title_id}` : "If no title is selected, list titles and ask me which title to use.",
              project_root ? `Project root: ${project_root}` : "Use the current game project root if available; otherwise ask me for project_root.",
              interval_hours ? `Scan interval hours: ${interval_hours}` : "Use the default daily scan interval.",
              "Call glitch_start_social_asset_watch with confirm=true. This should only scan and update the local candidate manifest; do not upload anything without explicit approval."
            ].join("\n")
          }
        }
      ]
    })
  );

  server.registerPrompt(
    "glitch_stop_local_social_asset_watch",
    {
      title: "Glitch Stop Local Social Watch",
      description: "Disable the local social asset watcher for a project.",
      argsSchema: {
        project_root: z.string().optional().describe("Local game project root on the machine running the stdio MCP.")
      }
    },
    async ({ project_root }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Use Glitch MCP to disable the local social asset watcher.",
              project_root ? `Project root: ${project_root}` : "Use the current game project root if available; otherwise ask me for project_root.",
              "Call glitch_stop_social_asset_watch."
            ].join("\n")
          }
        }
      ]
    })
  );
}
