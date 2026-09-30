/**
 * Generate-locations route: the image size limit the operator is promised.
 *
 * Two limits govern this upload and they have to agree. `parseFormData` enforces
 * its own `maxFileSize` while reading the multipart body, and the route then
 * checks `image.size` against `DEFAULT_MAX_IMAGE_UPLOAD_SIZE`. The parser runs
 * first, so if it is left on the library default (2 MiB) the route's 4 MB limit
 * is unreachable and a file the message says is fine dies as an unhandled parse
 * error.
 *
 * These tests drive the real parser over a real multipart body, so they measure
 * the limit that actually applies rather than the one the route states.
 *
 * @see {@link file://./../../../../app/routes/_layout+/admin-dashboard+/generate-locations.tsx}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { action } from "~/routes/_layout+/admin-dashboard+/generate-locations";
import { DEFAULT_MAX_IMAGE_UPLOAD_SIZE } from "~/utils/constants";

// why: the route writes locations and uploads to Supabase storage; stubbing at
// the module boundary keeps this a test of the upload limit.
vi.mock("~/modules/location/service.server", () => ({
  generateLocationWithImages: vi.fn(),
}));
vi.mock("~/utils/roles.server", () => ({
  requireAdmin: vi.fn(),
  requirePermission: vi.fn(),
}));
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

// why: the route answers failures with react-router's data(), which returns a
// DataWithResponseInit rather than a Response; mocking it to a real Response is
// the convention the other route tests use, and lets the status be asserted.
const createDataMock = vi.hoisted(
  () => () =>
    vi.fn(
      (payload: unknown, init?: ResponseInit) =>
        new Response(JSON.stringify(payload), {
          status: init?.status || 200,
          headers: { "Content-Type": "application/json" },
        })
    )
);
vi.mock("react-router", async () => ({
  ...(await vi.importActual("react-router")),
  data: createDataMock(),
}));

import { generateLocationWithImages } from "~/modules/location/service.server";
import { requireAdmin, requirePermission } from "~/utils/roles.server";

/** The library default the parser falls back to when given no `maxFileSize`. */
const PARSER_DEFAULT_MAX = 2 * 1024 * 1024;

/**
 * Builds a real multipart request carrying an image of `sizeInBytes`.
 *
 * why: the point of these tests is what the multipart parser does with the body,
 * so the body has to be a genuine multipart payload rather than a stub.
 */
function buildArgs(sizeInBytes: number) {
  const body = new FormData();
  body.append("numberOfLocations", "3");
  body.append(
    "image",
    new File([new Uint8Array(sizeInBytes)], "locations.jpg", {
      type: "image/jpeg",
    })
  );

  const request = new Request(
    "http://localhost/admin-dashboard/generate-locations",
    { method: "POST", body }
  );

  return {
    request,
    params: {},
    context: { getSession: () => ({ userId: "admin-1" }) },
  } as unknown as Parameters<typeof action>[0];
}

/**
 * Reads the error message out of the action's response.
 *
 * The action's declared return type is react-router's `DataWithResponseInit`;
 * the mock above turns that into a real `Response` at runtime, so these reads go
 * through `unknown` rather than claiming the two types overlap.
 */
async function messageFrom(response: unknown) {
  const body = (await asResponse(response).json()) as {
    error?: { message?: string };
  };

  return body.error?.message ?? null;
}

/** Reinterprets an action result as the `Response` the mocked `data()` returns. */
function asResponse(response: unknown): Response {
  return response as unknown as Response;
}

describe("admin generate-locations: image size limit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
    vi.mocked(requirePermission).mockResolvedValue({
      organizationId: "org-1",
    } as never);
    vi.mocked(generateLocationWithImages).mockResolvedValue(undefined as never);
  });

  it("accepts an image larger than the parser's default but within the stated limit", async () => {
    // 3 MB: over the 2 MiB default, under the 4 MB the route promises.
    const size = 3 * 1024 * 1024;
    expect(size).toBeGreaterThan(PARSER_DEFAULT_MAX);
    expect(size).toBeLessThan(DEFAULT_MAX_IMAGE_UPLOAD_SIZE);

    await action(buildArgs(size));

    expect(generateLocationWithImages).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1", numberOfLocations: 3 })
    );
  });

  it("accepts an image at exactly the stated limit", async () => {
    await action(buildArgs(DEFAULT_MAX_IMAGE_UPLOAD_SIZE));

    expect(generateLocationWithImages).toHaveBeenCalled();
  });

  it("refuses an oversized image by naming the limit, not with a generic failure", async () => {
    const response = await action(buildArgs(DEFAULT_MAX_IMAGE_UPLOAD_SIZE + 1));

    expect(generateLocationWithImages).not.toHaveBeenCalled();
    expect(await messageFrom(response)).toContain(
      `${DEFAULT_MAX_IMAGE_UPLOAD_SIZE / (1024 * 1024)}MB`
    );
  });

  it("answers 400 for an oversized image rather than a server error", async () => {
    const response = await action(buildArgs(DEFAULT_MAX_IMAGE_UPLOAD_SIZE + 1));

    expect(asResponse(response).status).toBe(400);
  });
});
