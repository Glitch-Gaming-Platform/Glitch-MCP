import { GLITCH_MCP_VERSION } from "./version.js";
import { GlitchMcpConfig } from "./config.js";
import { GlitchMcpError } from "./errors.js";

export interface RequestOptions {
  readonly method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  readonly query?: Record<string, unknown> | undefined;
  readonly body?: unknown;
}

export interface GlitchEnvelope<T> {
  readonly data: T;
}

export type FetchLike = (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>;

/**
 * Small, documented HTTP client for the hosted Glitch MCP facade.
 *
 * This client deliberately knows nothing about internal planner code. It only
 * handles transport concerns: auth headers, query strings, timeouts, response
 * envelopes, and sanitized error mapping.
 */
export class GlitchHttpClient {
  private readonly config: GlitchMcpConfig;
  private readonly fetchFn: FetchLike;

  constructor(config: GlitchMcpConfig, fetchFn: FetchLike = fetch) {
    this.config = config;
    this.fetchFn = fetchFn;
  }

  async get<T>(path: string, query?: Record<string, unknown>): Promise<T> {
    return this.request<T>(path, query ? { method: "GET", query } : { method: "GET" });
  }

  async post<T>(path: string, body?: unknown, query?: Record<string, unknown>): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      ...(body === undefined ? {} : { body }),
      ...(query ? { query } : {})
    });
  }

  /**
   * POST multipart/form-data (file uploads).
   *
   * The FormData body is passed straight to fetch so the runtime sets the
   * multipart boundary; we never set Content-Type ourselves for these requests.
   */
  async postMultipart<T>(path: string, form: FormData, query?: Record<string, unknown>): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      body: form,
      ...(query ? { query } : {})
    });
  }

  /**
   * Open a long-lived stream (Server-Sent Events) and return the raw Response.
   *
   * Unlike request(), this does not impose the per-call timeout (streams are
   * meant to stay open) and does not parse the body; the caller reads it. Aborting
   * is the caller's responsibility via the provided signal. Non-2xx responses are
   * mapped to a sanitized GlitchMcpError so callers can fall back to polling.
   */
  async openStream(path: string, query?: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: "text/event-stream",
      "User-Agent": `glitch-mcp/${GLITCH_MCP_VERSION}`,
      "X-Glitch-MCP-Version": GLITCH_MCP_VERSION,
      "X-Glitch-MCP-Client": this.config.clientName
    };
    if (this.config.token) {
      headers.Authorization = `Bearer ${this.config.token}`;
    }

    let response: Response;
    try {
      response = await this.fetchFn(this.urlFor(path, query), {
        method: "GET",
        headers,
        ...(signal ? { signal } : {})
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new GlitchMcpError("upstream_timeout", "The Glitch event stream was aborted.", { status: 408 });
      }
      throw new GlitchMcpError("upstream_error", "Unable to open the Glitch event stream.");
    }

    if (!response.ok) {
      throw errorForResponse(response, await readJson(response));
    }

    return response;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const isMultipart = typeof FormData !== "undefined" && options.body instanceof FormData;

    try {
      const init: RequestInit = {
        method: options.method || "GET",
        headers: this.headers(options.body, isMultipart),
        signal: controller.signal
      };

      if (options.body !== undefined) {
        init.body = isMultipart ? (options.body as FormData) : JSON.stringify(options.body);
      }

      const response = await this.fetchFn(this.urlFor(path, options.query), init);

      return await this.parseResponse<T>(response);
    } catch (error) {
      if (error instanceof GlitchMcpError) {
        throw error;
      }

      if (isAbortError(error)) {
        throw new GlitchMcpError("upstream_timeout", "The hosted Glitch MCP service timed out.", {
          status: 408
        });
      }

      throw new GlitchMcpError("upstream_error", "Unable to reach the hosted Glitch MCP service.");
    } finally {
      clearTimeout(timeout);
    }
  }

  private urlFor(path: string, query?: Record<string, unknown>): URL {
    const base = this.config.apiBaseUrl.replace(/\/+$/, "");
    const normalizedPath = path.replace(/^\/+/, "");
    const url = new URL(`${base}/${normalizedPath}`);

    for (const [key, rawValue] of Object.entries(query || {})) {
      if (rawValue === undefined || rawValue === null || rawValue === "") {
        continue;
      }

      if (Array.isArray(rawValue)) {
        for (const item of rawValue) {
          url.searchParams.append(key, String(item));
        }
      } else {
        url.searchParams.set(key, String(rawValue));
      }
    }

    return url;
  }

  private headers(body: unknown, isMultipart = false): HeadersInit {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": `glitch-mcp/${GLITCH_MCP_VERSION}`,
      "X-Glitch-MCP-Version": GLITCH_MCP_VERSION,
      "X-Glitch-MCP-Client": this.config.clientName
    };

    // For multipart bodies fetch must set Content-Type (with the boundary) itself.
    if (body !== undefined && !isMultipart) {
      headers["Content-Type"] = "application/json";
    }

    if (this.config.token) {
      headers.Authorization = `Bearer ${this.config.token}`;
    }

    return headers;
  }

  private async parseResponse<T>(response: Response): Promise<T> {
    const payload = await readJson(response);

    if (!response.ok) {
      throw errorForResponse(response, payload);
    }

    if (isEnvelope<T>(payload)) {
      return payload.data;
    }

    return payload as T;
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function isEnvelope<T>(payload: unknown): payload is GlitchEnvelope<T> {
  return typeof payload === "object" && payload !== null && "data" in payload;
}

function errorForResponse(response: Response, payload: unknown): GlitchMcpError {
  const objectPayload = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  const retryAfter = response.headers.get("retry-after");
  const message = stringValue(objectPayload.message) || stringValue(objectPayload.error) || response.statusText || "Glitch MCP request failed.";
  const details = {
    status: response.status,
    ...(retryAfter ? { retryAfterSeconds: Number.parseInt(retryAfter, 10) } : {}),
    ...(typeof objectPayload.billing_url === "string" ? { billingUrl: objectPayload.billing_url } : {}),
    ...(typeof objectPayload.dashboard_url === "string" ? { dashboardUrl: objectPayload.dashboard_url } : {}),
    ...(typeof objectPayload.errors === "object" && objectPayload.errors !== null ? { fieldErrors: objectPayload.errors as Record<string, unknown> } : {})
  };

  switch (response.status) {
    case 400:
    case 422:
      return new GlitchMcpError("validation_error", message, details);
    case 401:
      return new GlitchMcpError("authentication_required", message, details);
    case 402:
      return new GlitchMcpError("subscription_required", message, details);
    case 403:
      return new GlitchMcpError("permission_denied", message, details);
    case 404:
      return new GlitchMcpError("not_found", message, details);
    case 409:
      return new GlitchMcpError("conflict", message, details);
    case 429:
      return new GlitchMcpError("rate_limited", message, details);
    default:
      return new GlitchMcpError("upstream_error", message, details);
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
