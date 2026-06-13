import { JsonObject } from "./glitchClient.js";

export interface SseMessage {
  readonly event: string;
  readonly data: JsonObject;
  readonly raw: string;
}

/**
 * Parse a Server-Sent Events stream from a fetch Response body.
 *
 * Reads the response body to completion (or until the signal aborts), splitting
 * on blank-line record boundaries and invoking onMessage for each event. `data`
 * is JSON-parsed when possible; comments (`:` lines) and heartbeats are ignored.
 */
export async function parseSseStream(
  response: Response,
  onMessage: (message: SseMessage) => void | Promise<void>,
  signal?: AbortSignal
): Promise<void> {
  const body = response.body;
  if (!body) {
    return;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) {
        return;
      }

      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const rawRecord = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const message = parseRecord(rawRecord);
        if (message) {
          await onMessage(message);
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    // Releasing the lock lets the caller cancel the underlying connection.
    reader.releaseLock();
  }
}

function parseRecord(rawRecord: string): SseMessage | undefined {
  const lines = rawRecord.split("\n");
  let event = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line || line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).replace(/^\s/, ""));
    }
  }

  if (dataLines.length === 0) {
    return undefined;
  }

  const raw = dataLines.join("\n");
  let data: JsonObject;
  try {
    const parsed = JSON.parse(raw);
    data = typeof parsed === "object" && parsed !== null ? (parsed as JsonObject) : { value: parsed };
  } catch {
    data = { raw };
  }

  return { event, data, raw };
}
