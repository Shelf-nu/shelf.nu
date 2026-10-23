// @vitest-environment node
/**
 * `refreshExpiredKitImages`: which stored kit images the loader re-signs.
 *
 * Loaders call it on every list or detail read, so an expired URL it re-signs
 * reaches every viewer of the kit. Only a file inside the kit's own folder
 * (`<uploader>/<kitId>/...`) is signed; a stored URL naming any other path
 * keeps its stale URL.
 *
 * @see {@link file://./service.server.ts}
 */

const { mockKitUpdate, mockCreateSignedUrl } = vi.hoisted(() => ({
  mockKitUpdate: vi.fn(),
  mockCreateSignedUrl: vi.fn(),
}));

// why: the new URL is written back with Prisma; no real database in tests.
vi.mock("~/database/db.server", () => ({
  db: { $connect: vi.fn(), kit: { update: mockKitUpdate } },
}));

// why: signing a URL calls Supabase Storage, an external service. The
// filename it receives is the file the loader grants access to.
vi.mock("~/utils/storage.server", () => ({
  createSignedUrl: mockCreateSignedUrl,
  parseFileFormData: vi.fn(),
}));

import { refreshExpiredKitImages } from "./service.server";

const SUPABASE_URL = process.env.SUPABASE_URL;
const KIT_ID = "cmkitcamera0001";
const OWN_PATH = `5f0c6a2e-1111-4222-8333-444455556666/${KIT_ID}/image-1760000000.jpg`;
const OTHER_PATH =
  "9a8b7c6d-aaaa-4bbb-8ccc-ddddeeeeffff/cmotherkit0002/image-1750000000.jpg";
const FRESH_URL = `${SUPABASE_URL}/storage/v1/object/sign/kits/${OWN_PATH}?token=fresh`;

const signedKitUrl = (path: string) =>
  `${SUPABASE_URL}/storage/v1/object/sign/kits/${path}?token=t`;

/** A kit whose stored image URL expired a minute ago. */
const expiredKit = (image: string) => ({
  id: KIT_ID,
  organizationId: "org-1",
  image,
  imageExpiration: new Date(Date.now() - 60_000),
});

describe("refreshExpiredKitImages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSignedUrl.mockResolvedValue(FRESH_URL);
    mockKitUpdate.mockResolvedValue({});
  });

  it("re-signs an expired image inside the kit's own folder", async () => {
    const [kit] = await refreshExpiredKitImages([
      expiredKit(signedKitUrl(OWN_PATH)),
    ]);

    expect(mockCreateSignedUrl).toHaveBeenCalledWith({
      filename: OWN_PATH,
      bucketName: "kits",
    });
    expect(kit.image).toBe(FRESH_URL);
  });

  it("leaves a stored image outside the kit's own folder unsigned", async () => {
    const stale = expiredKit(signedKitUrl(OTHER_PATH));

    const [kit] = await refreshExpiredKitImages([stale]);

    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
    expect(mockKitUpdate).not.toHaveBeenCalled();
    expect(kit).toEqual(stale);
  });
});
