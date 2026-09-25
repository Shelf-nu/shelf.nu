import { beforeEach, describe, expect, it, vi } from "vitest";
import { PUBLIC_BUCKET } from "./constants";
import { SUPABASE_URL } from "./env";
import { ShelfError } from "./error";
import {
  findShelfErrorInCause,
  isSupabaseRateLimitError,
  isSupabaseServerError,
  MAX_PUBLIC_FILES_PER_REMOVE,
  removePublicFiles,
} from "./storage.server";

// why: the Supabase admin client talks to storage over HTTP; stub `remove` so
// the tests stay offline and can assert the paths sent in each request
const storageRemoveMock = vi.hoisted(() => vi.fn());
vi.mock("~/integrations/supabase/client", () => ({
  getSupabaseAdmin: () => ({
    storage: { from: () => ({ remove: storageRemoveMock }) },
  }),
}));

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

describe("isSupabaseServerError", () => {
  it("returns true for StorageApiError with status 504", () => {
    const error = {
      name: "StorageApiError",
      message: "Gateway Timeout",
      status: 504,
    };
    expect(isSupabaseServerError(error)).toBe(true);
  });

  it("returns true for StorageApiError with status 502", () => {
    const error = {
      name: "StorageApiError",
      message: "Bad Gateway",
      status: 502,
    };
    expect(isSupabaseServerError(error)).toBe(true);
  });

  it("returns true for StorageApiError with status 503", () => {
    const error = {
      name: "StorageApiError",
      message: "Service Unavailable",
      status: 503,
    };
    expect(isSupabaseServerError(error)).toBe(true);
  });

  it("returns true for StorageApiError with status 500", () => {
    const error = {
      name: "StorageApiError",
      message: "Internal Server Error",
      status: 500,
    };
    expect(isSupabaseServerError(error)).toBe(true);
  });

  it("returns true for StorageApiError with string statusCode '504'", () => {
    const error = {
      name: "StorageApiError",
      message: "Gateway Timeout",
      statusCode: "504",
    };
    expect(isSupabaseServerError(error)).toBe(true);
  });

  it("returns false for non-StorageApiError with 5xx status", () => {
    const error = {
      name: "StorageUnknownError",
      message: "Some error",
      status: 504,
    };
    expect(isSupabaseServerError(error)).toBe(false);
  });

  it("returns false for StorageApiError with 4xx status", () => {
    const error = {
      name: "StorageApiError",
      message: "Not found",
      status: 404,
    };
    expect(isSupabaseServerError(error)).toBe(false);
  });

  it("returns false for StorageApiError with status 429 (rate limit)", () => {
    const error = {
      name: "StorageApiError",
      message: "Too many requests",
      status: 429,
    };
    expect(isSupabaseServerError(error)).toBe(false);
  });

  it("returns false for null", () => {
    expect(isSupabaseServerError(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isSupabaseServerError(undefined)).toBe(false);
  });

  it("returns false for non-object values", () => {
    expect(isSupabaseServerError("error")).toBe(false);
    expect(isSupabaseServerError(42)).toBe(false);
  });

  it("returns false for empty object", () => {
    expect(isSupabaseServerError({})).toBe(false);
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

describe("removePublicFiles", () => {
  const publicUrlFor = (path: string) =>
    `${SUPABASE_URL}/storage/v1/object/public/${PUBLIC_BUCKET}/${path}`;

  beforeEach(() => {
    storageRemoveMock.mockReset();
    storageRemoveMock.mockResolvedValue({ data: [], error: null });
  });

  it("removes every file in a single storage request", async () => {
    const result = await removePublicFiles({
      publicUrls: [
        publicUrlFor("org-1/locations/loc-1/a.jpg"),
        publicUrlFor("org-1/locations/loc-1/a-thumbnail.jpg"),
        publicUrlFor("org-1/locations/loc-2/b.jpg"),
      ],
    });

    expect(storageRemoveMock).toHaveBeenCalledTimes(1);
    expect(storageRemoveMock).toHaveBeenCalledWith([
      "org-1/locations/loc-1/a.jpg",
      "org-1/locations/loc-1/a-thumbnail.jpg",
      "org-1/locations/loc-2/b.jpg",
    ]);
    expect(result).toEqual({ invalidUrlCount: 0 });
  });

  it("skips URLs outside the public bucket and still removes the rest", async () => {
    const result = await removePublicFiles({
      publicUrls: [
        "https://elsewhere.example.com/files/x.jpg",
        publicUrlFor("org-1/locations/loc-1/a.jpg"),
      ],
    });

    expect(storageRemoveMock).toHaveBeenCalledWith([
      "org-1/locations/loc-1/a.jpg",
    ]);
    expect(result).toEqual({ invalidUrlCount: 1 });
  });

  it("makes no request when no URL points into the public bucket", async () => {
    const result = await removePublicFiles({
      publicUrls: ["https://elsewhere.example.com/files/x.jpg"],
    });

    expect(storageRemoveMock).not.toHaveBeenCalled();
    expect(result).toEqual({ invalidUrlCount: 1 });
  });

  it("throws when the storage request fails", async () => {
    storageRemoveMock.mockResolvedValue({
      data: null,
      error: new Error("storage down"),
    });

    await expect(
      removePublicFiles({ publicUrls: [publicUrlFor("org-1/a.jpg")] })
    ).rejects.toBeInstanceOf(ShelfError);
  });

  it("refuses more files than one storage request accepts", async () => {
    const publicUrls = Array.from(
      { length: MAX_PUBLIC_FILES_PER_REMOVE + 1 },
      (_, i) => publicUrlFor(`org-1/${i}.jpg`)
    );

    await expect(removePublicFiles({ publicUrls })).rejects.toBeInstanceOf(
      ShelfError
    );
    expect(storageRemoveMock).not.toHaveBeenCalled();
  });
});
