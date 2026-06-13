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
}
