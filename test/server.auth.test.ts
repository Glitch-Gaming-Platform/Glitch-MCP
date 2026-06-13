import { describe, expect, it } from "vitest";
import { bearerFromAuthorization } from "../src/server.js";

describe("bearerFromAuthorization", () => {
  it("extracts a bearer token regardless of header casing and whitespace", () => {
    expect(bearerFromAuthorization("Bearer abc123")).toBe("abc123");
    expect(bearerFromAuthorization("bearer   abc123  ")).toBe("abc123");
    expect(bearerFromAuthorization("  Bearer\tabc123")).toBe("abc123");
  });

  it("uses the first value when given an array header", () => {
    expect(bearerFromAuthorization(["Bearer abc123", "Bearer other"])).toBe("abc123");
  });

  it("returns undefined for missing or non-bearer headers", () => {
    expect(bearerFromAuthorization(undefined)).toBeUndefined();
    expect(bearerFromAuthorization("")).toBeUndefined();
    expect(bearerFromAuthorization("Basic abc123")).toBeUndefined();
    expect(bearerFromAuthorization("Bearer ")).toBeUndefined();
    expect(bearerFromAuthorization(42 as unknown)).toBeUndefined();
  });
});
