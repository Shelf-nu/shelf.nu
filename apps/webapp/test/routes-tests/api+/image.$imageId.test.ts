// @vitest-environment node
/**
 * Stored-image delivery — the served content type is derived, not echoed.
 *
 * `Image.contentType` holds whatever the uploading client claimed, and rows
 * predating upload validation can hold any string at all. The route serves the
 * blob inline from the application origin to an authenticated viewer, so a
 * stored `text/html` would render as a document with the viewer's session
 * (GHSA-3jp3-wv4q-5mcv).
 *
 * The type therefore comes from the blob's magic bytes. These cases pin that
 * the stored string never reaches the response, which is what protects rows
 * already in the database.
 *
 * @see {@link file://./../../../app/routes/api+/image.$imageId.ts}
 */

// why: React Router v7 single fetch — `data()` must return a real Response so
// the error path has an assertable status.
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    data: vi.fn(
      (body: unknown, init?: ResponseInit) =>
        new Response(JSON.stringify(body), {
          status: init?.status || 200,
          headers: { "Content-Type": "application/json" },
        })
    ),
  };
});

const { mockImageFindFirstOrThrow, mockUserOrganizationFindMany } = vi.hoisted(
  () => ({
    mockImageFindFirstOrThrow: vi.fn(),
    mockUserOrganizationFindMany: vi.fn(),
  })
);
// why: the route's only collaborators are two Prisma reads; the assertion is
// about the response headers built from what they return.
vi.mock("~/database/db.server", () => ({
  db: {
    image: { findFirstOrThrow: mockImageFindFirstOrThrow },
    userOrganization: { findMany: mockUserOrganizationFindMany },
  },
}));

import { loader } from "~/routes/api+/image.$imageId";

const ORG_ID = "org-1";
const IMAGE_ID = "image-1";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const HTML_BYTES = Buffer.from("<script>alert(document.domain)</script>");

/** Stubs the row the route reads, with a caller-chosen stored content type. */
function givenStoredImage({
  blob,
  contentType,
}: {
  blob: Buffer;
  contentType: string;
}) {
  mockImageFindFirstOrThrow.mockResolvedValue({
    ownerOrgId: ORG_ID,
    contentType,
    blob,
    userId: "user-1",
  });
}

function args() {
  return {
    request: new Request(`https://app.shelf.nu/api/image/${IMAGE_ID}`),
    params: { imageId: IMAGE_ID },
    context: { getSession: () => ({ userId: "user-1", email: "a@b.c" }) },
  } as unknown as Parameters<typeof loader>[0];
}

describe("stored image delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserOrganizationFindMany.mockResolvedValue([
      { organization: { id: ORG_ID } },
    ]);
  });

  it("refuses to serve HTML bytes as a renderable document", async () => {
    givenStoredImage({ blob: HTML_BYTES, contentType: "text/html" });

    const response = (await loader(args())) as Response;

    expect(response.headers.get("Content-Type")).toBe(
      "application/octet-stream"
    );
    expect(response.headers.get("Content-Disposition")).toContain("attachment");
  });

  it("serves a real image under the type its bytes prove, not the stored one", async () => {
    givenStoredImage({ blob: PNG_BYTES, contentType: "text/html" });

    const response = (await loader(args())) as Response;

    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Content-Disposition")).toBe("inline");
  });

  it("blocks script execution on any image response", async () => {
    givenStoredImage({ blob: PNG_BYTES, contentType: "image/png" });

    const response = (await loader(args())) as Response;

    expect(response.headers.get("Content-Security-Policy")).toContain(
      "script-src 'none'"
    );
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("returns the stored bytes unchanged", async () => {
    givenStoredImage({ blob: PNG_BYTES, contentType: "image/png" });

    const response = (await loader(args())) as Response;

    expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG_BYTES);
  });

  it("still refuses a caller outside the owning organization", async () => {
    givenStoredImage({ blob: PNG_BYTES, contentType: "image/png" });
    mockUserOrganizationFindMany.mockResolvedValue([
      { organization: { id: "other-org" } },
    ]);

    const response = (await loader(args())) as Response;

    expect(response.status).toBe(403);
  });
});
