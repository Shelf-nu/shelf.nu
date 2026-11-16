import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUDIT_IMAGE_TEXT_FIELDS } from "~/modules/audit/image-form-fields";
import { PUBLIC_BUCKET } from "./constants";
import { SUPABASE_URL } from "./env";
import { ShelfError } from "./error";
import {
  findShelfErrorInCause,
  isSupabaseRateLimitError,
  isSupabaseServerError,
  MAX_PUBLIC_FILES_PER_REMOVE,
  parseFileFormData,
  removePublicFiles,
  safeUploadExtension,
  uploadFile,
} from "./storage.server";

// why: the Supabase admin client talks to storage over HTTP; stub `remove` so
// the tests stay offline and can assert the paths sent in each request
const storageRemoveMock = vi.hoisted(() => vi.fn());
// why: same client, for `upload`: a stored file's path is all the parser needs
const storageUploadMock = vi.hoisted(() =>
  vi.fn((path: string) => Promise.resolve({ data: { path }, error: null }))
);
vi.mock("~/integrations/supabase/client", () => ({
  getSupabaseAdmin: () => ({
    storage: {
      from: () => ({ remove: storageRemoveMock, upload: storageUploadMock }),
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

describe("unreadable image upload", () => {
  /** A JPEG cut off halfway: the header passes, the decoder fails. */
  async function truncatedJpeg(): Promise<Buffer> {
    const sharp = (await import("sharp")).default;
    const full = await sharp({
      create: { width: 64, height: 64, channels: 3, background: "#ef6820" },
    })
      .jpeg()
      .toBuffer();
    return full.subarray(0, Math.floor(full.length / 2));
  }

  it("keeps the 400 when uploadFile wraps it", async () => {
    const buffer = await truncatedJpeg();

    await expect(
      uploadFile(
        (async function* () {
          await Promise.resolve();
          yield new Uint8Array(buffer);
        })(),
        {
          filename: "asset.jpg",
          contentType: "image/jpeg",
          bucketName: "assets",
        }
      )
    ).rejects.toMatchObject({ status: 400, shouldBeCaptured: false });
  });

  it("keeps the 400 through the form-data parser's wrapping", async () => {
    const buffer = await truncatedJpeg();
    const form = new FormData();
    form.append(
      "mainImage",
      new File([new Uint8Array(buffer)], "asset.jpg", { type: "image/jpeg" })
    );

    await expect(
      parseFileFormData({
        request: new Request("http://localhost/assets/new", {
          method: "POST",
          body: form,
        }),
        newFileName: "asset-1/main",
        bucketName: "assets",
      })
    ).rejects.toMatchObject({
      status: 400,
      shouldBeCaptured: false,
      title: "Image could not be read",
    });
  });
});

describe("inspecting the original upload", () => {
  /** A real JPEG carrying a real EXIF capture date. */
  async function jpegWithDate(): Promise<Buffer> {
    const sharp = (await import("sharp")).default;
    return sharp({
      create: { width: 64, height: 64, channels: 3, background: "#2b6cb0" },
    })
      .jpeg()
      .withExif({ IFD2: { DateTimeOriginal: "2026:10:21 09:15:00" } })
      .toBuffer();
  }

  /** Uploads one file through the real form-data parser. */
  function upload(
    file: File,
    inspectOriginal: (
      original: Buffer,
      upload: { fieldName: string | undefined }
    ) => void
  ) {
    const form = new FormData();
    form.append("image", file);
    return parseFileFormData({
      request: new Request("http://localhost/audits/a/upload-image", {
        method: "POST",
        body: form,
      }),
      newFileName: "audit-1/photo",
      bucketName: "files",
      inspectOriginal,
    });
  }

  it("hands the inspector the file as uploaded, EXIF and all", async () => {
    // why: the stored copy is re-encoded without EXIF, so if the parser stops
    // forwarding the inspector every photo is silently saved with no date.
    const original = await jpegWithDate();
    const seen: Buffer[] = [];
    const fields: (string | undefined)[] = [];

    await upload(
      new File([new Uint8Array(original)], "photo.jpg", { type: "image/jpeg" }),
      (bytes, { fieldName }) => {
        seen.push(bytes);
        fields.push(fieldName);
      }
    );

    expect(seen).toHaveLength(1);
    expect(Buffer.compare(seen[0], original)).toBe(0);
    // The caller is told which form field the file came in.
    expect(fields).toEqual(["image"]);
  });

  it("never inspects a file the upload refuses as a format", async () => {
    // why: the handler admits any image/* type; the libraries behind an
    // inspector must not parse an SVG or TIFF the upload then rejects.
    const seen: Buffer[] = [];
    const svg = new File(
      ['<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>'],
      "photo.svg",
      { type: "image/svg+xml" }
    );

    await expect(
      upload(svg, (bytes) => void seen.push(bytes))
    ).rejects.toMatchObject({ status: 400 });
    expect(seen).toHaveLength(0);
  });

  it("still uploads when the inspector throws", async () => {
    const original = await jpegWithDate();

    const form = await upload(
      new File([new Uint8Array(original)], "photo.jpg", { type: "image/jpeg" }),
      () => {
        throw new Error("could not read EXIF");
      }
    );

    expect(form.get("image")).toBeTruthy();
  });
});

describe("parseFileFormData returns only what it uploaded", () => {
  const FOREIGN_PATH =
    "9a8b7c6d-aaaa-4bbb-8ccc-ddddeeeeffff/cmotherasset0002/main-image-1750000000.jpg";

  /** A real, decodable PNG, so the upload runs end to end. */
  async function png(): Promise<File> {
    const sharp = (await import("sharp")).default;
    const bytes = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#2b6cb0" },
    })
      .png()
      .toBuffer();
    return new File([new Uint8Array(bytes)], "photo.png", {
      type: "image/png",
    });
  }

  function parse(body: BodyInit) {
    return parseFileFormData({
      request: new Request("http://localhost/assets/a1/edit", {
        method: "POST",
        body,
      }),
      newFileName: "user-1/a1/main-image-1760000000",
      bucketName: "assets",
    });
  }

  beforeEach(() => {
    storageUploadMock.mockClear();
  });

  it("drops a multipart text field that names a storage path", async () => {
    const form = new FormData();
    form.append("mainImage", FOREIGN_PATH);

    const result = await parse(form);

    expect(result.get("mainImage")).toBeNull();
    expect(storageUploadMock).not.toHaveBeenCalled();
  });

  it("drops the field from a non-multipart body", async () => {
    const result = await parse(
      new URLSearchParams({ mainImage: FOREIGN_PATH })
    );

    expect(result.get("mainImage")).toBeNull();
  });

  it("returns the uploaded path, not a text part sent under the same name", async () => {
    const form = new FormData();
    form.append("mainImage", FOREIGN_PATH);
    form.append("mainImage", await png());

    const result = await parse(form);

    expect(result.getAll("mainImage")).toEqual([
      "user-1/a1/main-image-1760000000.png",
    ]);
  });

  it("drops a rejected non-image file part that shares a text part's name", async () => {
    const form = new FormData();
    form.append("mainImage", FOREIGN_PATH);
    form.append(
      "mainImage",
      new File(["<html></html>"], "page.html", { type: "text/html" })
    );

    const result = await parse(form);

    expect(result.get("mainImage")).toBeNull();
  });

  it("returns the thumbnail pair as one JSON value under the field", async () => {
    const form = new FormData();
    form.append("mainImage", await png());

    const result = await parseFileFormData({
      request: new Request("http://localhost/assets/a1/edit", {
        method: "POST",
        body: form,
      }),
      newFileName: "user-1/a1/main-image-1760000000",
      bucketName: "assets",
      generateThumbnail: true,
    });

    expect(JSON.parse(String(result.get("mainImage")))).toEqual({
      originalPath: "user-1/a1/main-image-1760000000.png",
      thumbnailPath: "user-1/a1/main-image-1760000000-thumbnail.png",
    });
  });

  it("keeps a client filename's path characters out of the storage path", async () => {
    const form = new FormData();
    form.append(
      "mainImage",
      new File(
        [new Uint8Array(await (await png()).arrayBuffer())],
        "x./%2e%2e/%2e%2e/victim/y",
        {
          type: "image/png",
        }
      )
    );

    const result = await parse(form);

    expect(result.get("mainImage")).toBe("user-1/a1/main-image-1760000000");
  });
});

describe("parseFileFormData text fields", () => {
  const FOREIGN_PATH = "other-user/other-asset/main-image-1.jpg";

  async function png(): Promise<File> {
    const sharp = (await import("sharp")).default;
    const bytes = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#2b6cb0" },
    })
      .png()
      .toBuffer();
    return new File([new Uint8Array(bytes)], "photo.png", {
      type: "image/png",
    });
  }

  it("returns the audit photo's note and capture details from the same parse", async () => {
    const form = new FormData();
    form.append("image", await png());
    form.append("content", "Dent on the lid");
    form.append("exifDateTimeOriginal", "2026:10:21 09:15:00");
    form.append("exifOffsetTimeOriginal", "+02:00");
    form.append("deviceTimeZone", "Europe/Sofia");
    form.append("captureSource", "CAMERA");

    const result = await parseFileFormData({
      request: new Request("http://localhost/api/mobile/audits/image", {
        method: "POST",
        body: form,
      }),
      newFileName: "org-1/audits/a1/img",
      bucketName: PUBLIC_BUCKET,
      textFields: AUDIT_IMAGE_TEXT_FIELDS,
    });

    expect(result.get("image")).toBe("org-1/audits/a1/img.png");
    expect(result.get("content")).toBe("Dent on the lid");
    expect(result.get("exifDateTimeOriginal")).toBe("2026:10:21 09:15:00");
    expect(result.get("exifOffsetTimeOriginal")).toBe("+02:00");
    expect(result.get("deviceTimeZone")).toBe("Europe/Sofia");
    expect(result.get("captureSource")).toBe("CAMERA");
  });

  it("neither uploads nor returns a file sent under a text field's name", async () => {
    storageUploadMock.mockClear();
    const form = new FormData();
    form.append("content", await png());
    form.append("content", "Dent on the lid");

    const result = await parseFileFormData({
      request: new Request("http://localhost/api/mobile/audits/image", {
        method: "POST",
        body: form,
      }),
      newFileName: "org-1/audits/a1/img",
      bucketName: PUBLIC_BUCKET,
      textFields: AUDIT_IMAGE_TEXT_FIELDS,
    });

    expect(result.getAll("content")).toEqual(["Dent on the lid"]);
    expect(storageUploadMock).not.toHaveBeenCalled();
  });

  it("returns only the named text fields, never one posing as the upload", async () => {
    const form = new FormData();
    form.append("image", FOREIGN_PATH);
    form.append("content", "note");
    form.append("unlisted", "dropped");

    const result = await parseFileFormData({
      request: new Request("http://localhost/api/mobile/audits/image", {
        method: "POST",
        body: form,
      }),
      newFileName: "org-1/audits/a1/img",
      bucketName: PUBLIC_BUCKET,
      textFields: AUDIT_IMAGE_TEXT_FIELDS,
    });

    expect(result.get("image")).toBeNull();
    expect(result.get("content")).toBe("note");
    expect(result.get("unlisted")).toBeNull();
  });
});

describe("safeUploadExtension", () => {
  it.each([
    ["photo.PNG", "png"],
    ["a.b.jpeg", "jpeg"],
    ["noext", undefined],
    ["x./%2e%2e/y", undefined],
    ["x.png/../../z", undefined],
    ["x.toolongext", undefined],
    [undefined, undefined],
  ])("%s -> %s", (name, expected) => {
    expect(safeUploadExtension(name)).toBe(expected);
  });
});
