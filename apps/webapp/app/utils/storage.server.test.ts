import { describe, expect, it } from "vitest";
import { ShelfError } from "./error";
import {
  findShelfErrorInCause,
  isSupabaseRateLimitError,
} from "./storage.server";

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

describe("findShelfErrorInCause", () => {
  it("returns the ShelfError when it is the top-level error", () => {
    const shelfError = new ShelfError({
      cause: null,
      message: "Unsupported image format",
      title: "Bad format",
      label: "Crop image",
      shouldBeCaptured: false,
    });

    const result = findShelfErrorInCause(shelfError);

    expect(result).toBe(shelfError);
    expect(result?.message).toBe("Unsupported image format");
    expect(result?.title).toBe("Bad format");
    expect(result?.shouldBeCaptured).toBe(false);
  });

  it("finds a ShelfError nested one level deep in the cause chain", () => {
    const shelfError = new ShelfError({
      cause: null,
      message: "Unsupported image format",
      title: "Bad format",
      label: "Crop image",
      shouldBeCaptured: false,
    });

    // Simulates FormDataParseError wrapping a ShelfError
    const wrapper = new Error("Cannot parse form data");
    wrapper.cause = shelfError;

    const result = findShelfErrorInCause(wrapper);

    expect(result).toBe(shelfError);
    expect(result?.message).toBe("Unsupported image format");
    expect(result?.title).toBe("Bad format");
    expect(result?.shouldBeCaptured).toBe(false);
  });

  it("finds a ShelfError nested multiple levels deep", () => {
    const shelfError = new ShelfError({
      cause: null,
      message: "Original error",
      label: "File storage",
      shouldBeCaptured: false,
    });

    const innerWrapper = new Error("Inner wrapper");
    innerWrapper.cause = shelfError;

    const outerWrapper = new Error("Outer wrapper");
    outerWrapper.cause = innerWrapper;

    const result = findShelfErrorInCause(outerWrapper);

    expect(result).toBe(shelfError);
  });

  it("returns null when no ShelfError exists in the cause chain", () => {
    const plainError = new Error("Something went wrong");

    expect(findShelfErrorInCause(plainError)).toBeNull();
  });

  it("returns null for null input", () => {
    expect(findShelfErrorInCause(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(findShelfErrorInCause(undefined)).toBeNull();
  });
});
