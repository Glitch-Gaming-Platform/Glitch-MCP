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

  registerGlitchToolCommandPrompts(server);
}

interface ToolCommandPrompt {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly guidance: string[];
}

const toolCommandPrompts: ToolCommandPrompt[] = [
  {
    name: "glitch_auth_status",
    title: "Glitch Auth Status",
    description: "Check whether the current token can access Glitch MCP.",
    guidance: ["If a title id is provided, pass it as title_id. Otherwise call the tool without title_id.", "Summarize authentication state and any setup step needed."]
  },
  {
    name: "glitch_list_titles",
    title: "Glitch List Titles",
    description: "List game titles available to the authenticated Glitch user or token.",
    guidance: ["Use include_archived=true only if the user asks for archived titles.", "Show each title with its id and a short selection note."]
  },
  {
    name: "glitch_select_title",
    title: "Glitch Select Title",
    description: "Select a default Glitch title for this MCP session.",
    guidance: ["Treat the first title-like argument as title_id.", "If no title id is provided, call glitch_list_titles first and ask which title to select."]
  },
  {
    name: "glitch_get_title_context",
    title: "Glitch Get Title Context",
    description: "Fetch safe, subscription-gated context for a game title.",
    guidance: ["Use the selected title unless a title id is provided.", "Summarize the title context for practical agent planning."]
  },
  {
    name: "glitch_get_billing_status",
    title: "Glitch Get Billing Status",
    description: "Check subscription, trial, plan, and credit state for a title.",
    guidance: ["Use the selected title unless a title id is provided.", "Summarize whether paid agent runs are available and include returned billing links."]
  },
  {
    name: "glitch_start_agent_run",
    title: "Glitch Start Agent Run",
    description: "Start a paid Glitch Agent run for a title.",
    guidance: [
      "Use the user's arguments as the task prompt and title/run options when clear.",
      "If no title is selected, call glitch_list_titles and ask which title to use.",
      "If the task prompt is missing or ambiguous, ask for the task before starting the run.",
      "By default, queue the run in the background unless the user explicitly asks to wait for completion."
    ]
  },
  {
    name: "glitch_get_agent_run",
    title: "Glitch Get Agent Run",
    description: "Fetch a durable Glitch Agent run by id.",
    guidance: ["Treat the first run-like id as run_id.", "Summarize status, report availability, open guidance, pending actions, and dashboard links."]
  },
  {
    name: "glitch_wait_for_agent_run",
    title: "Glitch Wait For Agent Run",
    description: "Wait for a Glitch Agent run until it completes or pauses.",
    guidance: ["Treat the first run-like id as run_id.", "When the wait ends, summarize status and fetch the final report if one is available."]
  },
  {
    name: "glitch_list_run_events",
    title: "Glitch List Run Events",
    description: "List user-visible timeline events for a Glitch Agent run.",
    guidance: ["Treat the first run-like id as run_id.", "Use after_id and limit only when clearly provided.", "Summarize the timeline in the clearest order."]
  },
  {
    name: "glitch_get_final_report",
    title: "Glitch Get Final Report",
    description: "Fetch the human-friendly final or partial report for a run.",
    guidance: ["Treat the first run-like id as run_id.", "Summarize the report and include dashboard or artifact links returned by Glitch."]
  },
  {
    name: "glitch_list_artifacts",
    title: "Glitch List Artifacts",
    description: "List downloadable files and hosted report artifacts for a run.",
    guidance: ["Treat the first run-like id as run_id.", "Summarize artifacts by type, purpose, and link."]
  },
  {
    name: "glitch_list_pending_actions",
    title: "Glitch List Pending Actions",
    description: "List proposed, approval-needed, approved, or executed actions.",
    guidance: ["Use provided title id, run id, status, and limit when clear.", "Summarize by status, risk, impact, required decision, and dashboard link.", "Do not approve or execute anything from this prompt."]
  },
  {
    name: "glitch_approve_action",
    title: "Glitch Approve Action",
    description: "Approve a reviewable Glitch Agent action after explicit confirmation.",
    guidance: ["Treat the first action-like id as action_id.", "Set confirm=true only when the user explicitly says to approve.", "If approval intent is unclear, show action details first and ask for confirmation."]
  },
  {
    name: "glitch_reject_action",
    title: "Glitch Reject Action",
    description: "Reject a proposed or approval-needed Glitch Agent action.",
    guidance: ["Treat the first action-like id as action_id.", "Use a provided reason if present; otherwise use a concise rejection reason.", "Summarize what was rejected."]
  },
  {
    name: "glitch_execute_action",
    title: "Glitch Execute Action",
    description: "Execute an approved Glitch Agent action after explicit confirmation.",
    guidance: ["Treat the first action-like id as action_id.", "Set confirm=true only when the user explicitly says to execute.", "If execution intent is unclear, show action details first and ask for confirmation."]
  },
  {
    name: "glitch_list_guidance",
    title: "Glitch List Guidance",
    description: "List open or answered guidance requests for a title or run.",
    guidance: ["Use provided title id, run id, status, and limit when clear.", "Summarize each question, needed decision, and dashboard link."]
  },
  {
    name: "glitch_answer_guidance",
    title: "Glitch Answer Guidance",
    description: "Answer a Glitch Agent guidance request and resume workflow.",
    guidance: ["Treat the first guidance-like id as guidance_id and the rest as the answer unless fields are labeled.", "If the id or answer is missing, ask for the missing value.", "Summarize whether the workflow resumed."]
  },
  {
    name: "glitch_resolve_guidance",
    title: "Glitch Resolve Guidance",
    description: "Present open stop-gate questions and route answers back to Glitch.",
    guidance: ["Use provided title id, run id, guidance id, and limit when clear.", "If interactive elicitation is unavailable, show a readable question list and ask the user for answers."]
  },
  {
    name: "glitch_setup_social_asset_folders",
    title: "Glitch Setup Social Asset Folders",
    description: "Create local Glitch social asset folders and config.",
    guidance: ["Treat the first path-like argument as project_root.", "Set confirm=true only when the user explicitly asks to create or set up folders.", "Summarize created folders and config path."]
  },
  {
    name: "glitch_start_social_asset_watch",
    title: "Glitch Start Social Asset Watch",
    description: "Activate the local social asset scan timer.",
    guidance: ["Treat the first path-like argument as project_root.", "Set confirm=true only when the user explicitly asks to start the watcher.", "Summarize watcher status and whether an immediate scan ran."]
  },
  {
    name: "glitch_stop_social_asset_watch",
    title: "Glitch Stop Social Asset Watch",
    description: "Disable the local social asset folder watcher.",
    guidance: ["Treat the first path-like argument as project_root.", "If project_root is missing, ask for it.", "Summarize whether the watcher was stopped."]
  },
  {
    name: "glitch_upload_social_asset_candidates",
    title: "Glitch Upload Social Asset Candidates",
    description: "Upload selected local scan candidates as Glitch Media.",
    guidance: ["Use provided project root, candidate ids, file paths, title id, platforms, and scheduler id when clear.", "Set confirm=true only when the user explicitly approves uploading.", "When create_title_updates=true, require title_promotion_schedule_id; do not guess among calendars."]
  },
  {
    name: "glitch_create_upload_url",
    title: "Glitch Create Upload URL",
    description: "Create a short-lived upload URL for attaching a file.",
    guidance: ["Use provided file name, mime type, size in bytes, title id, and run id when clear.", "If any required value is missing, ask for it."]
  },
  {
    name: "glitch_upload_file",
    title: "Glitch Upload File",
    description: "Upload a local image, video, or document to a Glitch title or run.",
    guidance: ["Treat the first path-like argument as file_path unless base64 content is provided.", "Confirm the user intentionally asked to send this local file to Glitch before uploading.", "Summarize the uploaded file and attachment id."]
  },
  {
    name: "glitch_open_dashboard",
    title: "Glitch Open Dashboard",
    description: "Return Glitch dashboard links for a title, run, action, or billing screen.",
    guidance: ["Infer kind from the request when clear: title, run, action, or billing.", "Use provided title id, run id, and action id when present.", "Return dashboard links with short labels."]
  }
];

function registerGlitchToolCommandPrompts(server: McpServer): void {
  for (const prompt of toolCommandPrompts) {
    server.registerPrompt(
      prompt.name,
      {
        title: prompt.title,
        description: prompt.description,
        argsSchema: {
          input: z.string().optional().describe("Optional free-form ids, paths, options, or notes passed with this command.")
        }
      },
      async ({ input }) => ({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                `Use Glitch MCP tool \`${prompt.name}\`.`,
                input ? `Arguments I provided: ${input}` : "No arguments provided.",
                ...prompt.guidance,
                "If a required id, path, or value is missing, ask me before calling the tool."
              ].join("\n")
            }
          }
        ]
      })
    );
  }
}
