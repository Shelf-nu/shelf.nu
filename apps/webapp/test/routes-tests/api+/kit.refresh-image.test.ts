// @vitest-environment node
/**
 * `POST /api/kit/refresh-image`: re-signs the kit's own stored image.
 *
 * The route writes the new signed URL back onto the kit, and deleting a kit
 * removes the file that stored URL names. So the file to sign comes from the
 * kit row (scoped to the caller's organization), never from the request: an
 * `image` field in the body is ignored. A stored URL naming a file outside the
 * kit's own folder (`<uploader>/<kitId>/...`) is not signed either.
 *
 * The real kit service runs here (`refreshKitImage`, `updateKit`); only the
 * database, storage, activity events and the auth gate are mocked.
 *
 * @see {@link file://./../../../app/routes/api+/kit.refresh-image.ts}
 * @see {@link file://./../../../app/modules/kit/service.server.ts}
 */

const { mockKitFindFirst, mockKitUpdate, mockCreateSignedUrl } = vi.hoisted(
  () => ({
    mockKitFindFirst: vi.fn(),
    mockKitUpdate: vi.fn(),
    mockCreateSignedUrl: vi.fn(),
  })
);

// why: the stored kit image is read, and the new URL written, with Prisma;
// no real database in tests.
vi.mock("~/database/db.server", () => ({
  db: {
    $connect: vi.fn(),
    kit: { findFirst: mockKitFindFirst, update: mockKitUpdate },
  },
}));

// why: signing a URL calls Supabase Storage, an external service. The
// filename it receives is the file the route grants access to.
vi.mock("~/utils/storage.server", () => ({
  createSignedUrl: mockCreateSignedUrl,
}));

// why: the activity event the update records is not under test.
vi.mock("~/modules/activity-event/service.server", () => ({
  recordEvent: vi.fn(),
  recordEvents: vi.fn(),
}));

// why: the RBAC gate is not under test; it must pass with the caller's org.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn().mockResolvedValue({ organizationId: "org-1" }),
}));

import { action } from "~/routes/api+/kit.refresh-image";

const SUPABASE_URL = process.env.SUPABASE_URL;
const KIT_ID = "cmkitcamera0001";
const OWN_PATH = `5f0c6a2e-1111-4222-8333-444455556666/${KIT_ID}/image-1760000000.jpg`;
const OTHER_PATH =
  "9a8b7c6d-aaaa-4bbb-8ccc-ddddeeeeffff/cmotherkit0002/image-1750000000.jpg";

const signedKitUrl = (path: string) =>
  `${SUPABASE_URL}/storage/v1/object/sign/kits/${path}?token=t`;

function refreshRequest(fields: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return new Request("https://app.shelf.nu/api/kit/refresh-image", {
    method: "POST",
    body: formData,
  });
}

function actionArgs(request: Request) {
  return {
    request,
    params: {},
    context: { getSession: () => ({ userId: "user-1" }) },
  } as unknown as Parameters<typeof action>[0];
}

describe("kit image refresh action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSignedUrl.mockResolvedValue(signedKitUrl(OWN_PATH));
    mockKitUpdate.mockResolvedValue({ id: KIT_ID });
  });

  it("re-signs the kit's stored image and ignores an image URL in the request", async () => {
    mockKitFindFirst.mockResolvedValue({ image: signedKitUrl(OWN_PATH) });

    const response = await action(
      actionArgs(
        refreshRequest({ kitId: KIT_ID, image: signedKitUrl(OTHER_PATH) })
      )
    );

    expect(response.init?.status ?? 200).toBe(200);
    expect(mockKitFindFirst).toHaveBeenCalledWith({
      where: { id: KIT_ID, organizationId: "org-1" },
      select: { image: true },
    });
    expect(mockCreateSignedUrl).toHaveBeenCalledTimes(1);
    expect(mockCreateSignedUrl).toHaveBeenCalledWith({
      filename: OWN_PATH,
      bucketName: "kits",
    });
    expect(mockKitUpdate).toHaveBeenCalledWith({
      where: { id: KIT_ID, organizationId: "org-1" },
      data: expect.objectContaining({
        image: signedKitUrl(OWN_PATH),
        imageExpiration: expect.any(Date),
      }),
    });
  });

  it("signs nothing for a kit outside the caller's organization", async () => {
    mockKitFindFirst.mockResolvedValue(null);

    const response = await action(
      actionArgs(
        refreshRequest({
          kitId: "cmforeignkit0003",
          image: signedKitUrl(OTHER_PATH),
        })
      )
    );

    expect(response.init?.status).toBe(404);
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
    expect(mockKitUpdate).not.toHaveBeenCalled();
  });

  it("signs nothing when the stored image lies outside the kit's own folder", async () => {
    mockKitFindFirst.mockResolvedValue({ image: signedKitUrl(OTHER_PATH) });

    const response = await action(
      actionArgs(refreshRequest({ kitId: KIT_ID }))
    );

    expect(response.init?.status).toBe(404);
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
    expect(mockKitUpdate).not.toHaveBeenCalled();
  });
});
