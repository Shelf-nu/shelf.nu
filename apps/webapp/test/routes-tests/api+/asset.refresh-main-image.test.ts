// @vitest-environment node
/**
 * `GET /api/asset/refresh-main-image`: re-signs the asset's own stored image.
 *
 * The bucket is signed with the service-role client, so the file to sign comes
 * from the asset row (scoped to the caller's organization), never from the
 * request: a `mainImage` path in the query string is ignored.
 *
 * Only the database, storage and the auth gate are mocked.
 *
 * @see {@link file://./../../../app/routes/api+/asset.refresh-main-image.ts}
 */

const { mockAssetFindUnique, mockAssetUpdate, mockCreateSignedUrl } =
  vi.hoisted(() => ({
    mockAssetFindUnique: vi.fn(),
    mockAssetUpdate: vi.fn(),
    mockCreateSignedUrl: vi.fn(),
  }));

// why: the stored image is read, and the new URL written, with Prisma; no
// real database in tests.
vi.mock("~/database/db.server", () => ({
  db: {
    $connect: vi.fn(),
    asset: { findUnique: mockAssetFindUnique, update: mockAssetUpdate },
  },
}));

// why: signing a URL calls Supabase Storage, an external service. The
// filename it receives is the file the route grants access to.
vi.mock("~/utils/storage.server", () => ({
  createSignedUrl: mockCreateSignedUrl,
  uploadFile: vi.fn(),
}));

// why: thumbnail generation downloads from Supabase Storage; every fixture
// here already has a thumbnail, so the client must never be reached.
vi.mock("~/integrations/supabase/client", () => ({
  getSupabaseAdmin: vi.fn(() => {
    throw new Error("Supabase admin client must not be used in this test");
  }),
}));

// why: the asset service module pulls in the whole asset domain; the route
// only needs its storage-error classifier.
vi.mock("~/modules/asset/service.server", () => ({
  isStorageObjectNotFound: vi.fn(() => false),
}));

// why: the RBAC gate is not under test; it must pass with the caller's org.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn().mockResolvedValue({ organizationId: "org-1" }),
}));

import { loader } from "~/routes/api+/asset.refresh-main-image";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ASSET_ID = "cmassetcamera0001";
const OWN_PATH = `5f0c6a2e-1111-4222-8333-444455556666/${ASSET_ID}/main-image-1760000000.jpg`;
const OWN_THUMB = `5f0c6a2e-1111-4222-8333-444455556666/${ASSET_ID}/main-image-1760000000-thumbnail.jpg`;
const OTHER_WORKSPACE_PATH =
  "9a8b7c6d-aaaa-4bbb-8ccc-ddddeeeeffff/cmotherasset0002/main-image-1750000000.jpg";

const signedAssetUrl = (path: string) =>
  `${SUPABASE_URL}/storage/v1/object/sign/assets/${path}?token=t`;

function loaderArgs(query: Record<string, string>) {
  const request = new Request(
    `https://app.shelf.nu/api/asset/refresh-main-image?${new URLSearchParams(
      query
    ).toString()}`
  );
  return {
    request,
    params: {},
    context: { getSession: () => ({ userId: "user-1" }) },
  } as unknown as Parameters<typeof loader>[0];
}

describe("asset main image refresh loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSignedUrl.mockImplementation(({ filename }) =>
      Promise.resolve(signedAssetUrl(filename))
    );
    mockAssetUpdate.mockImplementation(({ data: update }) =>
      Promise.resolve({ id: ASSET_ID, ...update })
    );
  });

  it("signs the asset's stored image and ignores a path in the query string", async () => {
    mockAssetFindUnique.mockResolvedValue({
      id: ASSET_ID,
      mainImage: signedAssetUrl(OWN_PATH),
      thumbnailImage: signedAssetUrl(OWN_THUMB),
    });

    const response = await loader(
      loaderArgs({ assetId: ASSET_ID, mainImage: OTHER_WORKSPACE_PATH })
    );

    expect(response.init?.status ?? 200).toBe(200);
    expect(mockAssetFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ASSET_ID, organizationId: "org-1" },
      })
    );
    const signedFiles = mockCreateSignedUrl.mock.calls.map(
      ([args]) => args.filename
    );
    expect(signedFiles).toEqual([OWN_PATH, OWN_THUMB]);
    expect(signedFiles).not.toContain(OTHER_WORKSPACE_PATH);
    expect(mockAssetUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ASSET_ID, organizationId: "org-1" },
        data: expect.objectContaining({
          mainImage: signedAssetUrl(OWN_PATH),
        }),
      })
    );
  });

  it("signs nothing for an asset without a stored image", async () => {
    mockAssetFindUnique.mockResolvedValue({
      id: ASSET_ID,
      mainImage: null,
      thumbnailImage: null,
    });

    await loader(
      loaderArgs({ assetId: ASSET_ID, mainImage: OTHER_WORKSPACE_PATH })
    );

    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  it("signs nothing for an asset outside the caller's organization", async () => {
    mockAssetFindUnique.mockResolvedValue(null);

    await loader(
      loaderArgs({ assetId: "cmforeignasset0003", mainImage: OWN_PATH })
    );

    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
    expect(mockAssetUpdate).not.toHaveBeenCalled();
  });
});
