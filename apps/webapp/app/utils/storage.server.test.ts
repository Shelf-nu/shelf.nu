import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShelfError } from "./error";
import {
  findShelfErrorInCause,
  isSupabaseRateLimitError,
  isSupabaseServerError,
  parsePdfFormData,
  removeFilesByPrefix,
} from "./storage.server";

// why: parsePdfFormData uploads to real Supabase Storage via
// getSupabaseAdmin() - stub only that network boundary so the multipart
// parsing this security test exercises runs for real, unmocked.
const mockUpload = vi.fn();
// why: removeFilesByPrefix paginates through Supabase Storage's list() and
// then calls remove() - stub both so the pagination loop can be exercised
// without a real bucket.
const mockList = vi.fn();
const mockRemove = vi.fn();
vi.mock("~/integrations/supabase/client", () => ({
  getSupabaseAdmin: () => ({
    storage: {
      from: () => ({
        upload: mockUpload,
        list: mockList,
        remove: mockRemove,
      }),
    },
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

describe("parsePdfFormData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mirrors Supabase's real upload() response: echoes back the path it
    // was asked to store at.
    mockUpload.mockImplementation((path: string) => ({
      data: { path },
      error: null,
    }));
  });

  /**
   * Builds a raw multipart/form-data body by hand rather than relying on a
   * FormData's automatic serialization - the happy-dom test environment
   * doesn't reliably reproduce a real browser/undici multipart encoding,
   * and the whole point of these tests is exercising the actual byte-level
   * parsing this security fix protects.
   */
  function multipartRequest(
    parts: {
      name: string;
      filename?: string;
      contentType?: string;
      body: string;
    }[]
  ) {
    const boundary = "----vitestboundary123";
    const segments = parts.map((part) => {
      const disposition = part.filename
        ? `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"`
        : `Content-Disposition: form-data; name="${part.name}"`;
      const contentTypeLine = part.contentType
        ? `Content-Type: ${part.contentType}\r\n`
        : "";
      return `--${boundary}\r\n${disposition}\r\n${contentTypeLine}\r\n${part.body}`;
    });
    const body = `${segments.join("\r\n")}\r\n--${boundary}--\r\n`;

    return new Request("http://localhost/test", {
      method: "POST",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });
  }

  const PDF_BODY = "%PDF-1.4\nfake pdf content";

  it("uploads a real PDF and returns its path/name/size directly - not via FormData", async () => {
    const request = multipartRequest([
      {
        name: "file",
        filename: "invoice.pdf",
        contentType: "application/pdf",
        body: PDF_BODY,
      },
    ]);

    const result = await parsePdfFormData({
      request,
      newFileName: "org-1/asset-1/attachment-123",
    });

    expect(result.path).toBe("org-1/asset-1/attachment-123.pdf");
    expect(result.originalName).toBe("invoice.pdf");
    expect(result.size).toBe(PDF_BODY.length);
    expect(mockUpload).toHaveBeenCalledOnce();
  });

  it("rejects a plain text 'file' field forging an upload result", async () => {
    // No `filename` attribute - multipart text fields do not invoke the upload
    // handler and therefore cannot provide stored attachment metadata.
    const forgedPath = "other-org/other-asset/attachment-stolen.pdf";
    const request = multipartRequest([
      {
        name: "file",
        body: JSON.stringify({
          path: forgedPath,
          originalName: "not-really-uploaded.pdf",
          size: 1,
        }),
      },
    ]);

    await expect(
      parsePdfFormData({
        request,
        newFileName: "org-1/asset-1/attachment-999",
      })
    ).rejects.toThrow();

    // Confirms the forged path never reached storage - Supabase's upload()
    // must never have been called with attacker-supplied data.
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("rejects a file whose declared type is application/pdf but whose bytes are not", async () => {
    const request = multipartRequest([
      {
        name: "file",
        filename: "fake.pdf",
        contentType: "application/pdf",
        body: "<html>not a pdf</html>",
      },
    ]);

    await expect(
      parsePdfFormData({
        request,
        newFileName: "org-1/asset-1/attachment-000",
      })
    ).rejects.toThrow(/not a valid PDF/);

    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("rejects a file part with no Content-Type header at all", async () => {
    const request = multipartRequest([
      { name: "file", filename: "no-type.pdf", body: PDF_BODY },
    ]);

    await expect(
      parsePdfFormData({
        request,
        newFileName: "org-1/asset-1/attachment-111",
      })
    ).rejects.toThrow();

    expect(mockUpload).not.toHaveBeenCalled();
  });
});

describe("removeFilesByPrefix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes every entry across multiple list() pages, not just the first", async () => {
    // Supabase Storage's list() caps a single call at `limit` entries
    const firstPage = Array.from({ length: 100 }, (_, i) => ({
      name: `file-${i}.pdf`,
    }));
    const secondPage = [{ name: "file-100.pdf" }, { name: "file-101.pdf" }];

    mockList
      .mockResolvedValueOnce({ data: firstPage, error: null })
      .mockResolvedValueOnce({ data: secondPage, error: null });
    mockRemove.mockResolvedValue({ data: [], error: null });

    await removeFilesByPrefix({
      organizationId: "org-1",
      entityId: "asset-1",
      bucketName: "attachments",
    });

    expect(mockList).toHaveBeenCalledTimes(2);
    expect(mockList).toHaveBeenNthCalledWith(1, "org-1/asset-1", {
      limit: 100,
      offset: 0,
    });
    expect(mockList).toHaveBeenNthCalledWith(2, "org-1/asset-1", {
      limit: 100,
      offset: 100,
    });

    const expectedPaths = [...firstPage, ...secondPage].map(
      (entry) => `org-1/asset-1/${entry.name}`
    );
    expect(mockRemove).toHaveBeenCalledOnce();
    expect(mockRemove).toHaveBeenCalledWith(expectedPaths);
  });

  it("stops after a single page when it comes back short of the page size", async () => {
    mockList.mockResolvedValueOnce({
      data: [{ name: "only-file.pdf" }],
      error: null,
    });
    mockRemove.mockResolvedValue({ data: [], error: null });

    await removeFilesByPrefix({
      organizationId: "org-1",
      entityId: "asset-1",
    });

    expect(mockList).toHaveBeenCalledOnce();
    expect(mockRemove).toHaveBeenCalledWith(["org-1/asset-1/only-file.pdf"]);
  });

  it("does nothing when the prefix has no files at all", async () => {
    mockList.mockResolvedValueOnce({ data: [], error: null });

    await removeFilesByPrefix({
      organizationId: "org-1",
      entityId: "asset-1",
    });

    expect(mockRemove).not.toHaveBeenCalled();
  });
});
