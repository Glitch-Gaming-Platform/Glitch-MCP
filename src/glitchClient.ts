import { GlitchMcpConfig } from "./config.js";
import { GlitchMcpError, titleRequiredError } from "./errors.js";
import { FetchLike, GlitchHttpClient } from "./http.js";
import { SseMessage, parseSseStream } from "./sse.js";

export type JsonObject = Record<string, unknown>;

export interface TitleSelectionStore {
  get(): string | undefined;
  set(titleId: string): void;
}

/**
 * In-memory title selection for stdio sessions.
 *
 * Remote hosted MCP deployments should generally rely on OAuth scopes and
 * explicit title_id arguments. The local stdio proxy can safely keep a selected
 * title for the lifetime of one developer's MCP process.
 */
export class MemoryTitleSelectionStore implements TitleSelectionStore {
  private selectedTitleId?: string;

  get(): string | undefined {
    return this.selectedTitleId;
  }

  set(titleId: string): void {
    this.selectedTitleId = titleId;
  }
}

export interface GlitchClientOptions {
  /**
   * Per-session bearer token that overrides config.token.
   *
   * The Streamable HTTP transport sets this from each incoming request's
   * Authorization header so a hosted, multi-tenant deployment forwards the
   * caller's own credential instead of a single shared operator token. The
   * stdio proxy leaves this undefined and falls back to config.token.
   */
  readonly authToken?: string;

  /**
   * Whether glitch_upload_file may read files from the local disk.
   *
   * Defaults to config.allowLocalFileReads, then false. The stdio transport
   * passes true (developer's own machine); the shared HTTP transport leaves it
   * false so it never reads the server's filesystem from a tool argument.
   */
  readonly allowLocalFileReads?: boolean;
}

export class GlitchClient {
  private readonly config: GlitchMcpConfig;
  private readonly http: GlitchHttpClient;
  private readonly titles: TitleSelectionStore;

  /** Whether the upload tool may read local file paths in this session. */
  readonly canReadLocalFiles: boolean;

  /** Optional real-path roots that local file uploads must stay inside. */
  readonly uploadAllowedRoots: readonly string[];

  constructor(
    config: GlitchMcpConfig,
    fetchFn?: FetchLike,
    titles: TitleSelectionStore = new MemoryTitleSelectionStore(),
    options: GlitchClientOptions = {}
  ) {
    // A per-request auth token always takes precedence over the static config
    // token so the same adapter code is safe in single-tenant stdio mode and
    // multi-tenant hosted HTTP mode.
    this.config = options.authToken ? { ...config, token: options.authToken } : config;
    this.http = new GlitchHttpClient(this.config, fetchFn);
    this.titles = titles;
    this.canReadLocalFiles = options.allowLocalFileReads ?? this.config.allowLocalFileReads ?? false;
    this.uploadAllowedRoots = this.config.uploadAllowedRoots || [];
  }

  get selectedTitleId(): string | undefined {
    return this.titles.get() || this.config.defaultTitleId;
  }

  dashboardUrl(kind: "title" | "run" | "action" | "billing", input: { titleId: string; runId?: string; actionId?: string }): string {
    const base = this.config.dashboardBaseUrl.replace(/\/+$/, "");
    const titlePath = `${base}/agents/titles/${encodeURIComponent(input.titleId)}`;

    switch (kind) {
      case "run":
        return input.runId ? `${titlePath}?run=${encodeURIComponent(input.runId)}` : titlePath;
      case "action":
        return input.actionId ? `${titlePath}?action=${encodeURIComponent(input.actionId)}` : titlePath;
      case "billing":
        return `${titlePath}/billing`;
      case "title":
      default:
        return titlePath;
    }
  }

  resolveTitleId(inputTitleId?: string): string {
    const titleId = inputTitleId || this.titles.get() || this.config.defaultTitleId;
    if (!titleId) {
      throw titleRequiredError();
    }
    return titleId;
  }

  async authStatus(titleId?: string): Promise<JsonObject> {
    return this.http.get<JsonObject>("/mcp/v1/auth/status", { title_id: titleId });
  }

  async listTitles(includeArchived = false): Promise<JsonObject> {
    return this.http.get<JsonObject>("/mcp/v1/titles", { include_archived: includeArchived });
  }

  async selectTitle(titleId: string): Promise<JsonObject> {
    const context = await this.titleContext(titleId);
    this.titles.set(titleId);
    return {
      selected_title_id: titleId,
      context
    };
  }

  async titleContext(titleId: string): Promise<JsonObject> {
    return this.http.get<JsonObject>(`/mcp/v1/titles/${segment(titleId)}/context`);
  }

  async billingStatus(titleId: string): Promise<JsonObject> {
    return this.http.get<JsonObject>(`/mcp/v1/titles/${segment(titleId)}/billing`);
  }

  async startRun(titleId: string, body: JsonObject): Promise<JsonObject> {
    return this.http.post<JsonObject>(`/mcp/v1/titles/${segment(titleId)}/runs`, body);
  }

  async getRun(titleId: string, runId: string): Promise<JsonObject> {
    return this.http.get<JsonObject>(`/mcp/v1/titles/${segment(titleId)}/runs/${segment(runId)}`);
  }

  async waitForRun(titleId: string, runId: string, timeoutMs: number, pollIntervalMs: number): Promise<JsonObject> {
    const startedAt = Date.now();
    let lastRun: JsonObject | undefined;

    while (Date.now() - startedAt <= timeoutMs) {
      lastRun = await this.getRun(titleId, runId);
      if (runIsSettled(lastRun)) {
        return {
          timed_out: false,
          run: lastRun
        };
      }

      await sleep(pollIntervalMs);
    }

    return {
      timed_out: true,
      run: lastRun,
      message: `Timed out waiting for run ${runId}. Use glitch_get_agent_run or glitch_wait_for_agent_run to continue polling.`
    };
  }

  async runEvents(titleId: string, runId: string, query: JsonObject): Promise<JsonObject> {
    return this.http.get<JsonObject>(`/mcp/v1/titles/${segment(titleId)}/runs/${segment(runId)}/events`, query);
  }

  /**
   * Open the run's SSE stream and forward each event to onMessage.
   *
   * Resolves with the settled run payload when a `settled` event arrives, or
   * undefined if the stream closes/times out first. Throws GlitchMcpError if the
   * stream cannot be opened (e.g. an older backend without the endpoint) so the
   * caller can fall back to polling.
   */
  async streamRunEvents(
    titleId: string,
    runId: string,
    options: { signal?: AbortSignal; afterSeq?: number; onMessage?: (message: SseMessage) => void | Promise<void> } = {}
  ): Promise<JsonObject | undefined> {
    const query = options.afterSeq ? { after_seq: options.afterSeq } : undefined;
    const response = await this.http.openStream(
      `/mcp/v1/titles/${segment(titleId)}/runs/${segment(runId)}/stream`,
      query,
      options.signal
    );

    let settledRun: JsonObject | undefined;
    await parseSseStream(
      response,
      async (message) => {
        await options.onMessage?.(message);
        if (message.event === "settled") {
          settledRun = message.data;
        }
        if (message.event === "error") {
          throw new GlitchMcpError("upstream_error", String(message.data.message || "Glitch event stream error."));
        }
      },
      options.signal
    );

    return settledRun;
  }

  /**
   * Wait for a run to settle, streaming live events when possible.
   *
   * Prefers the SSE stream (forwarding each event to onEvent for live progress)
   * and transparently falls back to polling if streaming is unavailable or the
   * stream ends before the run settles.
   */
  async waitForRunStreaming(
    titleId: string,
    runId: string,
    options: {
      timeoutMs: number;
      pollIntervalMs: number;
      signal?: AbortSignal;
      onEvent?: (message: SseMessage) => void | Promise<void>;
    }
  ): Promise<JsonObject> {
    const deadline = Date.now() + options.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    const onAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const settled = await this.streamRunEvents(titleId, runId, {
        signal: controller.signal,
        ...(options.onEvent ? { onMessage: options.onEvent } : {})
      });
      if (settled) {
        return { timed_out: false, run: settled };
      }
    } catch {
      // Streaming unavailable or interrupted — fall back to polling below.
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    }

    const remaining = Math.max(0, deadline - Date.now());
    if (remaining <= 0) {
      const run = await this.getRun(titleId, runId);
      return runIsSettled(run) ? { timed_out: false, run } : { timed_out: true, run };
    }

    return this.waitForRun(titleId, runId, remaining, options.pollIntervalMs);
  }

  async finalReport(titleId: string, runId: string): Promise<JsonObject> {
    return this.http.get<JsonObject>(`/mcp/v1/titles/${segment(titleId)}/runs/${segment(runId)}/report`);
  }

  async artifacts(titleId: string, runId: string): Promise<JsonObject> {
    return this.http.get<JsonObject>(`/mcp/v1/titles/${segment(titleId)}/runs/${segment(runId)}/artifacts`);
  }

  async pendingActions(titleId: string, query: JsonObject): Promise<JsonObject> {
    return this.http.get<JsonObject>(`/mcp/v1/titles/${segment(titleId)}/actions`, query);
  }

  async approveAction(titleId: string, actionId: string, body: JsonObject): Promise<JsonObject> {
    return this.http.post<JsonObject>(`/mcp/v1/titles/${segment(titleId)}/actions/${segment(actionId)}/approve`, body);
  }

  async rejectAction(titleId: string, actionId: string, body: JsonObject): Promise<JsonObject> {
    return this.http.post<JsonObject>(`/mcp/v1/titles/${segment(titleId)}/actions/${segment(actionId)}/reject`, body);
  }

  async executeAction(titleId: string, actionId: string, body: JsonObject): Promise<JsonObject> {
    return this.http.post<JsonObject>(`/mcp/v1/titles/${segment(titleId)}/actions/${segment(actionId)}/execute`, body);
  }

  async guidance(titleId: string, query: JsonObject): Promise<JsonObject> {
    return this.http.get<JsonObject>(`/mcp/v1/titles/${segment(titleId)}/guidance`, query);
  }

  async answerGuidance(titleId: string, guidanceId: string, body: JsonObject): Promise<JsonObject> {
    return this.http.post<JsonObject>(`/mcp/v1/titles/${segment(titleId)}/guidance/${segment(guidanceId)}/answer`, body);
  }

  async createUploadUrl(titleId: string, body: JsonObject): Promise<JsonObject> {
    return this.http.post<JsonObject>(`/mcp/v1/titles/${segment(titleId)}/uploads`, body);
  }

  /**
   * Upload a file directly to the MCP facade using multipart/form-data.
   *
   * The hosted facade re-checks the title scope, subscription, and allowed mime
   * types, and stores the file behind the prompt-injection boundary.
   */
  async uploadFile(
    titleId: string,
    input: { bytes: Uint8Array; fileName: string; mimeType: string; agentRunId?: string }
  ): Promise<JsonObject> {
    const form = new FormData();
    const blob = new Blob([input.bytes as BlobPart], { type: input.mimeType });
    form.append("file", blob, input.fileName);
    if (input.agentRunId) {
      form.append("agent_run_id", input.agentRunId);
    }
    return this.http.postMultipart<JsonObject>(`/mcp/v1/titles/${segment(titleId)}/files`, form);
  }

  /**
   * Upload a developer-selected screenshot, clip, trailer, or marketing export as
   * first-class Glitch Media so existing AI media processing and social library
   * workflows can handle it.
   */
  async uploadMediaAsset(
    titleId: string,
    input: {
      bytes: Uint8Array;
      fileName: string;
      mimeType: string;
      agentRunId?: string;
      createTitleUpdate?: boolean;
      titlePromotionScheduleId?: string;
      platforms?: readonly string[];
      sourceMetadata?: JsonObject;
    }
  ): Promise<JsonObject> {
    const form = new FormData();
    const blob = new Blob([input.bytes as BlobPart], { type: input.mimeType });
    form.append("media", blob, input.fileName);
    if (input.agentRunId) {
      form.append("agent_run_id", input.agentRunId);
    }
    if (input.createTitleUpdate !== undefined) {
      form.append("create_title_update", input.createTitleUpdate ? "1" : "0");
    }
    if (input.titlePromotionScheduleId) {
      form.append("title_promotion_schedule_id", input.titlePromotionScheduleId);
    }
    if (input.platforms?.length) {
      form.append("platforms", JSON.stringify(input.platforms));
    }
    if (input.sourceMetadata) {
      form.append("source_metadata", JSON.stringify(input.sourceMetadata));
    }
    return this.http.postMultipart<JsonObject>(`/mcp/v1/titles/${segment(titleId)}/media`, form);
  }
}

/**
 * Run states that should stop a wait loop.
 *
 * This is the union of the hosted Glitch backend's TERMINAL and PAUSED run
 * statuses (see McpAgentController). Keep it in sync so glitch_wait_for_agent_run
 * returns promptly for runs that are stopped or paused for user input instead of
 * polling until timeout.
 */
const SETTLED_RUN_STATUSES = [
  // Terminal
  "completed",
  "failed",
  "blocked",
  "canceled",
  "cancelled",
  "stopped",
  // Paused for the user
  "needs_guidance",
  "needs_approval",
  "waiting",
  "paused"
];

export function isRunSettled(status: string): boolean {
  return SETTLED_RUN_STATUSES.includes(status.toLowerCase());
}

/**
 * Decide whether a run payload represents a settled run.
 *
 * Prefers the backend-provided is_settled flag (authoritative, drift-proof) and
 * falls back to matching the status string when an older backend omits it.
 */
export function runIsSettled(run: JsonObject): boolean {
  if (typeof run.is_settled === "boolean") {
    return run.is_settled;
  }
  if (run.is_terminal === true || run.is_paused === true) {
    return true;
  }
  return isRunSettled(String(run.status || ""));
}

export function segment(value: string): string {
  return encodeURIComponent(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
