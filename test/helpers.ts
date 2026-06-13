import { expect } from "vitest";
import type { FetchLike } from "../src/http.js";

export interface CapturedRequest {
  readonly url: string;
  readonly init: RequestInit | undefined;
  readonly body: unknown;
}

export function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...(headers || {})
    }
  });
}

export function createFetchMock(handler: (request: CapturedRequest, index: number) => Response | Promise<Response>): {
  readonly fetch: FetchLike;
  readonly requests: CapturedRequest[];
} {
  const requests: CapturedRequest[] = [];

  return {
    requests,
    fetch: async (input, init) => {
      const url = input instanceof URL ? input.toString() : String(input);
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      const request = { url, init, body };
      requests.push(request);
      return handler(request, requests.length - 1);
    }
  };
}

export function expectAuthorization(init: RequestInit | undefined, token: string): void {
  const headers = new Headers(init?.headers);
  expect(headers.get("authorization")).toBe(`Bearer ${token}`);
}
