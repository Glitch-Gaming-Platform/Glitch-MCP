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

  dashboardUrl(kind: "title" | "run" | "action" | "billing" | "hosting", input: { titleId: string; runId?: string; actionId?: string }): string {
    const base = this.config.dashboardBaseUrl.replace(/\/+$/, "");
    const titlePath = `${base}/agents/titles/${encodeURIComponent(input.titleId)}`;

    switch (kind) {
      case "run":
        return input.runId ? `${titlePath}?run=${encodeURIComponent(input.runId)}` : titlePath;
      case "action":
        return input.actionId ? `${titlePath}?action=${encodeURIComponent(input.actionId)}` : titlePath;
      case "billing":
        return `${titlePath}/billing`;
      case "hosting":
        return `${base}/games/admin/${encodeURIComponent(input.titleId)}/hosting`;
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

  async analyticsCapabilities(titleId: string): Promise<JsonObject> {
    return this.http.get<JsonObject>(`/mcp/v1/titles/${segment(titleId)}/analytics/capabilities`);
  }

  async analyticsQuery(titleId: string, body: JsonObject): Promise<JsonObject> {
    return this.http.post<JsonObject>(`/mcp/v1/titles/${segment(titleId)}/analytics/query`, body);
  }

  async billingStatus(titleId: string): Promise<JsonObject> {
    return this.http.get<JsonObject>(`/mcp/v1/titles/${segment(titleId)}/billing`);
  }

  // --- Azure game website hosting ---
  async hostingDashboard(titleId: string): Promise<JsonObject> {
    return this.http.get<JsonObject>(`/titles/${segment(titleId)}/hosting`);
  }

  async hostingChannelAnalytics(titleId: string, query?: JsonObject): Promise<JsonObject> {
    return this.http.get<JsonObject>(`/titles/${segment(titleId)}/hosting/analytics/channels`, query);
  }

  async createHostingSite(titleId: string, body: JsonObject): Promise<JsonObject> {
    return this.http.post<JsonObject>(`/titles/${segment(titleId)}/hosting/sites`, body);
  }

  async updateHostingSite(titleId: string, siteId: string, body: JsonObject): Promise<JsonObject> {
    return this.http.put<JsonObject>(`/titles/${segment(titleId)}/hosting/sites/${segment(siteId)}`, body);
  }

  async hostingReleases(titleId: string, siteId: string, query?: JsonObject): Promise<JsonObject> {
    return this.http.get<JsonObject>(
      `/titles/${segment(titleId)}/hosting/sites/${segment(siteId)}/releases`,
      query
    );
  }

  async createHostingRelease(titleId: string, siteId: string, body: JsonObject): Promise<JsonObject> {
    return this.http.post<JsonObject>(
      `/titles/${segment(titleId)}/hosting/sites/${segment(siteId)}/releases`,
      body
    );
  }

  async promoteHostingRelease(titleId: string, siteId: string, releaseId: string): Promise<JsonObject> {
    return this.http.post<JsonObject>(
      `/titles/${segment(titleId)}/hosting/sites/${segment(siteId)}/releases/${segment(releaseId)}/promote`,
      {}
    );
  }

  async connectHostingDomain(titleId: string, siteId: string, hostname: string): Promise<JsonObject> {
    return this.http.post<JsonObject>(`/titles/${segment(titleId)}/hosting/sites/${segment(siteId)}/domains`, { hostname });
  }

  async verifyHostingDomain(titleId: string, siteId: string, domainId: string): Promise<JsonObject> {
    return this.http.post<JsonObject>(
      `/titles/${segment(titleId)}/hosting/sites/${segment(siteId)}/domains/${segment(domainId)}/verify`,
      {}
    );
  }

  async hostingAiInstructions(titleId: string, siteId: string, body: JsonObject): Promise<JsonObject> {
    return this.http.post<JsonObject>(
      `/titles/${segment(titleId)}/hosting/sites/${segment(siteId)}/ai-instructions`,
      body
    );
  }

  async checkHostingDomainAvailability(titleId: string, hostname: string): Promise<JsonObject> {
    return this.http.post<JsonObject>(`/mcp/v1/titles/${segment(titleId)}/hosting/domains/check`, { hostname });
  }

  async purchaseHostingDomain(titleId: string, siteId: string, body: JsonObject): Promise<JsonObject> {
    return this.http.post<JsonObject>(
      `/mcp/v1/titles/${segment(titleId)}/hosting/sites/${segment(siteId)}/domains/purchase`,
      body
    );
  }

  async changeHostingPlan(titleId: string, body: JsonObject): Promise<JsonObject> {
    return this.http.post<JsonObject>(`/mcp/v1/titles/${segment(titleId)}/hosting/billing/checkout`, body);
  }

  async confirmHostingCheckout(titleId: string, checkoutSessionId: string): Promise<JsonObject> {
    return this.http.post<JsonObject>(`/mcp/v1/titles/${segment(titleId)}/hosting/billing/confirm`, {
      checkout_session_id: checkoutSessionId,
      confirm: true
    });
  }

  async listHostingDatabases(titleId: string, siteId: string, query?: JsonObject): Promise<JsonObject> {
    return this.http.get<JsonObject>(
      `/mcp/v1/titles/${segment(titleId)}/hosting/sites/${segment(siteId)}/databases`,
      query
    );
  }

  async getHostingDatabase(titleId: string, siteId: string, databaseId: string): Promise<JsonObject> {
    return this.http.get<JsonObject>(
      `/mcp/v1/titles/${segment(titleId)}/hosting/sites/${segment(siteId)}/databases/${segment(databaseId)}`
    );
  }

  async createHostingDatabase(titleId: string, siteId: string, body: JsonObject): Promise<JsonObject> {
    return this.http.post<JsonObject>(
      `/mcp/v1/titles/${segment(titleId)}/hosting/sites/${segment(siteId)}/databases`,
      body
    );
  }

  async updateHostingDatabase(titleId: string, siteId: string, databaseId: string, body: JsonObject): Promise<JsonObject> {
    return this.http.put<JsonObject>(
      `/mcp/v1/titles/${segment(titleId)}/hosting/sites/${segment(siteId)}/databases/${segment(databaseId)}`,
      body
    );
  }

  async retryHostingDatabase(titleId: string, siteId: string, databaseId: string, body: JsonObject): Promise<JsonObject> {
    return this.http.post<JsonObject>(
      `/mcp/v1/titles/${segment(titleId)}/hosting/sites/${segment(siteId)}/databases/${segment(databaseId)}/retry`,
      body
    );
  }

  async deleteHostingDatabase(titleId: string, siteId: string, databaseId: string, confirmation: string): Promise<JsonObject> {
    return this.http.deleteWithBody<JsonObject>(
      `/mcp/v1/titles/${segment(titleId)}/hosting/sites/${segment(siteId)}/databases/${segment(databaseId)}`,
      { confirmation, confirm: true }
    );
  }

  async waitForDeploymentReady(titleId: string, buildId: string, timeoutMs: number, pollIntervalMs: number): Promise<JsonObject> {
    const startedAt = Date.now();

    while (Date.now() - startedAt <= timeoutMs) {
      const deployments = await this.listDeployments(titleId, { per_page: 100 });
      const build = collectionItems(deployments).find((item) => String(item.id || "") === buildId);
      if (build) {
        const status = String(build.status || "").toLowerCase();
        if (status === "ready") {
          return build;
        }
        if (status === "failed") {
          throw new GlitchMcpError(
            "upstream_error",
            String(build.error_message || build.error || `Game build ${buildId} failed during deployment.`)
          );
        }
      }

      await sleep(pollIntervalMs);
    }

    throw new GlitchMcpError("upstream_timeout", `Timed out waiting for game build ${buildId} to become ready.`, { status: 408 });
  }

  async waitForHostingReleaseReady(
    titleId: string,
    siteId: string,
    releaseId: string,
    timeoutMs: number,
    pollIntervalMs: number
  ): Promise<JsonObject> {
    const startedAt = Date.now();

    while (Date.now() - startedAt <= timeoutMs) {
      const releases = await this.hostingReleases(titleId, siteId, { per_page: 100 });
      const release = collectionItems(releases).find((item) => String(item.id || "") === releaseId);
      if (release) {
        const status = String(release.status || "").toLowerCase();
        if (["ready", "active", "inactive"].includes(status)) {
          return release;
        }
        if (status === "failed") {
          throw new GlitchMcpError(
            "upstream_error",
            String(release.error_message || `Hosting release ${releaseId} failed during processing.`)
          );
        }
      }

      await sleep(pollIntervalMs);
    }

    throw new GlitchMcpError("upstream_timeout", `Timed out waiting for hosting release ${releaseId} to become ready.`, { status: 408 });
  }

  async socialCapabilities(titleId: string): Promise<JsonObject> {
    return this.http.get<JsonObject>(`/mcp/v1/titles/${segment(titleId)}/social/capabilities`);
  }

  async socialOperation(titleId: string, operation: string, args: JsonObject, confirm = false): Promise<JsonObject> {
    return this.http.post<JsonObject>(
      `/mcp/v1/titles/${segment(titleId)}/social/operations/${segment(operation)}`,
      { arguments: args, confirm }
    );
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

  /*
   * Game services (public title API, scoped by the configured title token/JWT).
   *
   * Unlike the /mcp/v1 agent surface above, these hit the same title-scoped
   * routes a game client uses (title_or_jwt auth), so the MCP/agent can operate
   * multiplayer, cloud save, progression, and deployments for the game
   * associated with the current title token. Player-scoped calls take a
   * player_id / install_id in the body just like the SDK.
   */

  // --- Multiplayer ---
  async listMultiplayerLobbies(titleId: string, query?: JsonObject): Promise<JsonObject> {
    return this.http.get<JsonObject>(`/titles/${segment(titleId)}/multiplayer/lobbies`, query);
  }

  async createMultiplayerLobby(titleId: string, body: JsonObject): Promise<JsonObject> {
    return this.http.post<JsonObject>(`/titles/${segment(titleId)}/multiplayer/lobbies`, body);
  }

  async browseMultiplayerServers(titleId: string, query?: JsonObject): Promise<JsonObject> {
    return this.http.get<JsonObject>(`/titles/${segment(titleId)}/multiplayer/servers`, query);
  }

  async listMultiplayerRealms(titleId: string, query?: JsonObject): Promise<JsonObject> {
    return this.http.get<JsonObject>(`/titles/${segment(titleId)}/multiplayer/realms`, query);
  }

  // --- Installs (the key used by cloud save, leaderboards, achievements) ---
  async createInstall(titleId: string, body: JsonObject): Promise<JsonObject> {
    return this.http.post<JsonObject>(`/titles/${segment(titleId)}/installs`, body);
  }

  async validateInstall(titleId: string, installId: string, body?: JsonObject): Promise<JsonObject> {
    return this.http.post<JsonObject>(`/titles/${segment(titleId)}/installs/${segment(installId)}/validate`, body);
  }

  // --- Cloud save ---
  async listCloudSaves(titleId: string, installId: string, query?: JsonObject): Promise<JsonObject> {
    return this.http.get<JsonObject>(`/titles/${segment(titleId)}/installs/${segment(installId)}/saves`, query);
  }

  async storeCloudSave(titleId: string, installId: string, body: JsonObject): Promise<JsonObject> {
    return this.http.post<JsonObject>(`/titles/${segment(titleId)}/installs/${segment(installId)}/saves`, body);
  }

  async resolveCloudSaveConflict(titleId: string, installId: string, saveId: string, body: JsonObject): Promise<JsonObject> {
    return this.http.post<JsonObject>(`/titles/${segment(titleId)}/installs/${segment(installId)}/saves/${segment(saveId)}/resolve`, body);
  }

  // --- Progression: shared submit + leaderboards + achievements ---
  async submitProgression(titleId: string, installId: string, body: JsonObject): Promise<JsonObject> {
    return this.http.post<JsonObject>(`/titles/${segment(titleId)}/installs/${segment(installId)}/submit`, body);
  }

  async listLeaderboardDefinitions(titleId: string): Promise<JsonObject> {
    return this.http.get<JsonObject>(`/titles/${segment(titleId)}/progression/leaderboards`);
  }

  async readLeaderboard(titleId: string, apiKey: string, query?: JsonObject): Promise<JsonObject> {
    return this.http.get<JsonObject>(`/titles/${segment(titleId)}/leaderboards/${segment(apiKey)}`, query);
  }

  async listAchievementDefinitions(titleId: string): Promise<JsonObject> {
    return this.http.get<JsonObject>(`/titles/${segment(titleId)}/progression/achievements`);
  }

  async listPlayerAchievements(titleId: string, installId: string): Promise<JsonObject> {
    return this.http.get<JsonObject>(`/titles/${segment(titleId)}/installs/${segment(installId)}/achievements`);
  }

  // --- Deployments ---
  async listDeployments(titleId: string, query?: JsonObject): Promise<JsonObject> {
    return this.http.get<JsonObject>(`/titles/${segment(titleId)}/deployments`, query);
  }

  async updateDeploymentStatus(titleId: string, buildId: string, body: JsonObject): Promise<JsonObject> {
    return this.http.put<JsonObject>(`/titles/${segment(titleId)}/deployments/${segment(buildId)}/status`, body);
  }

  // --- Multipart build upload (S3 pre-signed part flow) ---
  async initiateDeploymentUpload(titleId: string, body?: JsonObject): Promise<JsonObject> {
    return this.http.post<JsonObject>(`/titles/${segment(titleId)}/deployments/multipart/initiate`, body ?? {});
  }

  async getDeploymentPartUrls(titleId: string, body: JsonObject): Promise<JsonObject> {
    return this.http.post<JsonObject>(`/titles/${segment(titleId)}/deployments/multipart/urls`, body);
  }

  async completeDeploymentUpload(titleId: string, body: JsonObject): Promise<JsonObject> {
    return this.http.post<JsonObject>(`/titles/${segment(titleId)}/deployments/multipart/complete`, body);
  }

  async confirmDeployment(titleId: string, body: JsonObject): Promise<JsonObject> {
    return this.http.post<JsonObject>(`/titles/${segment(titleId)}/deployments/confirm`, body);
  }

  /**
   * PUT one part to its S3 pre-signed URL and return the ETag S3 assigns.
   * The ETag (quoted) is required, in PartNumber order, to complete the upload.
   */
  async uploadDeploymentPart(presignedUrl: string, bytes: Uint8Array): Promise<string> {
    const response = await this.http.putBinary(presignedUrl, bytes, "application/zip");
    const etag = response.headers.get("etag");
    if (!etag) {
      throw new GlitchMcpError("upstream_error", "S3 did not return an ETag for the uploaded part.");
    }
    return etag;
  }

  /**
   * PUT a whole object to a single pre-signed URL (the local/dev fallback the
   * initiate endpoint returns as { upload_url, is_local }). No ETag is required.
   */
  async putDeploymentObject(presignedUrl: string, bytes: Uint8Array): Promise<void> {
    await this.http.putBinary(presignedUrl, bytes, "application/zip");
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

function collectionItems(payload: unknown): JsonObject[] {
  if (Array.isArray(payload)) {
    return payload.filter((item): item is JsonObject => typeof item === "object" && item !== null && !Array.isArray(item));
  }
  if (typeof payload === "object" && payload !== null) {
    const items = (payload as JsonObject).data;
    if (Array.isArray(items)) {
      return items.filter((item): item is JsonObject => typeof item === "object" && item !== null && !Array.isArray(item));
    }
  }
  return [];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
