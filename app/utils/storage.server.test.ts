import { describe, expect, it } from "vitest";
import { isSupabaseRateLimitError } from "./storage.server";

describe("isSupabaseRateLimitError", () => {
  it("returns true for StorageApiError with numeric status 429", () => {
    const error = {
      name: "StorageApiError",
      message: "Too many requests",
      status: 429,
    };
    expect(isSupabaseRateLimitError(error)).toBe(true);
  });

  it("returns true for StorageApiError with string statusCode '429'", () => {
    const error = {
      name: "StorageApiError",
      message: "Rate limit exceeded",
      statusCode: "429",
    };
    expect(isSupabaseRateLimitError(error)).toBe(true);
  });

  it('returns true for StorageApiError with "too many" in message', () => {
    const error = {
      name: "StorageApiError",
      message: "Too many connections issued to the database",
      status: 0,
    };
    expect(isSupabaseRateLimitError(error)).toBe(true);
  });

  it('returns true for case-insensitive "too many" matching', () => {
    const error = {
      name: "StorageApiError",
      message: "TOO MANY REQUESTS",
    };
    expect(isSupabaseRateLimitError(error)).toBe(true);
  });

  it("returns false for non-StorageApiError with status 429", () => {
    const error = {
      name: "StorageUnknownError",
      message: "Some error",
      status: 429,
    };
    expect(isSupabaseRateLimitError(error)).toBe(false);
  });

  it("returns false for StorageApiError with non-429 status", () => {
    const error = {
      name: "StorageApiError",
      message: "Not found",
      status: 404,
    };
    expect(isSupabaseRateLimitError(error)).toBe(false);
  });

  it("returns false for null", () => {
    expect(isSupabaseRateLimitError(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isSupabaseRateLimitError(undefined)).toBe(false);
  });

  it("returns false for non-object values", () => {
    expect(isSupabaseRateLimitError("error")).toBe(false);
    expect(isSupabaseRateLimitError(42)).toBe(false);
  });

  it("returns false for empty object", () => {
    expect(isSupabaseRateLimitError({})).toBe(false);
  });
});
