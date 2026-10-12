// @vitest-environment node
/**
 * Kit detail action, `delete` intent: which image file leaves storage.
 *
 * Deleting a kit removes exactly one file: the kit's own stored image, read
 * from the kit row. An `image` field in the request is ignored, and a stored
 * URL that points outside the kit's own folder (`<uploader>/<kitId>/...`) is
 * refused, so a kit delete can never take another kit's file with it.
 *
 * The real kit service runs here (`assertKitDeleteConfirmed`, `deleteKit`,
 * `deleteKitImage`); only the database, storage and the auth gate are mocked.
 *
 * @see {@link file://./../../../app/routes/_layout+/kits.$kitId.tsx}
 * @see {@link file://./../../../app/modules/kit/service.server.ts}
 */

const { dbMocks, mockRemove, mockFrom } = vi.hoisted(() => {
  const mockRemove = vi.fn();
  return {
    dbMocks: {
      kitFindFirst: vi.fn(),
      kitFindUniqueOrThrow: vi.fn(),
      kitDeleteMany: vi.fn(),
      assetKitFindMany: vi.fn(),
    },
    mockRemove,
    mockFrom: vi.fn(() => ({ remove: mockRemove })),
  };
});

// why: the delete runs against Prisma; these are the only calls an AVAILABLE
// kit with no members makes, and none of them should reach a real database.
vi.mock("~/database/db.server", () => {
  const tx = {
    assetKit: { findMany: dbMocks.assetKitFindMany },
    kit: { deleteMany: dbMocks.kitDeleteMany },
  };
  return {
    db: {
      $connect: vi.fn(),
      kit: {
        findFirst: dbMocks.kitFindFirst,
        findUniqueOrThrow: dbMocks.kitFindUniqueOrThrow,
      },
      $transaction: vi.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
    },
  };
});

// why: Supabase Storage is an external service. `remove` is the call under
// test: every path it receives is a file that would be deleted.
vi.mock("~/integrations/supabase/client", () => ({
  getSupabaseAdmin: () => ({ storage: { from: mockFrom } }),
}));

// why: the RBAC gate is not under test; it must pass with the caller's org.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn().mockResolvedValue({ organizationId: "org-1" }),
}));

// why: the action loads the acting user before branching on intent.
vi.mock("~/modules/user/service.server", () => ({
  getUserByID: vi.fn().mockResolvedValue({
    id: "user-1",
    firstName: "Test",
    lastName: "User",
    displayName: null,
  }),
}));

// why: the toast is a server-sent event side effect, not part of the delete.
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

import { action } from "~/routes/_layout+/kits.$kitId";
import { Logger } from "~/utils/logger";

const SUPABASE_URL = process.env.SUPABASE_URL;
const KIT_ID = "cmkitcamera0001";
const KIT_NAME = "Camera Kit";
const UPLOADER_ID = "5f0c6a2e-1111-4222-8333-444455556666";

/** Path of this kit's own image, in the shape `updateKitImage` writes. */
const OWN_PATH = `${UPLOADER_ID}/${KIT_ID}/image-1760000000.jpg`;
/** Path of a different kit's image in the same bucket. */
const OTHER_PATH =
  "9a8b7c6d-aaaa-4bbb-8ccc-ddddeeeeffff/cmotherkit0002/image-1750000000.jpg";

const signedKitUrl = (path: string) =>
  `${SUPABASE_URL}/storage/v1/object/sign/kits/${path}?token=t`;

function deleteRequest(fields: Record<string, string>) {
  const formData = new FormData();
  formData.set("intent", "delete");
  formData.set("confirmation", KIT_NAME);
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return new Request(`https://app.shelf.nu/kits/${KIT_ID}`, {
    method: "POST",
    body: formData,
  });
}

function actionArgs(request: Request) {
  return {
    request,
    params: { kitId: KIT_ID },
    context: { getSession: () => ({ userId: "user-1" }) },
  } as unknown as Parameters<typeof action>[0];
}

/** Makes the kit row in the database carry `image`. */
function storedKit(image: string | null) {
  dbMocks.kitFindUniqueOrThrow.mockResolvedValue({
    id: KIT_ID,
    name: KIT_NAME,
    image,
    assetKits: [],
    custody: null,
  });
}

/** Every storage path handed to `remove`, across all calls. */
const removedPaths = () => mockRemove.mock.calls.flatMap(([paths]) => paths);

describe("kit detail action: delete removes only the kit's own image", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.kitFindFirst.mockResolvedValue({ name: KIT_NAME });
    dbMocks.assetKitFindMany.mockResolvedValue([]);
    dbMocks.kitDeleteMany.mockResolvedValue({ count: 1 });
    mockRemove.mockResolvedValue({ data: [], error: null });
    // why: a refused or failed image delete is logged, not thrown; the spy
    // lets a test assert that and keeps the expected error out of the output.
    vi.spyOn(Logger, "error").mockImplementation(() => {});
  });

  it("deletes the stored image and ignores an image URL sent with the request", async () => {
    storedKit(signedKitUrl(OWN_PATH));

    const response = await action(
      actionArgs(deleteRequest({ image: signedKitUrl(OTHER_PATH) }))
    );

    expect((response as Response).status).toBe(302);
    expect(dbMocks.kitDeleteMany).toHaveBeenCalledWith({
      where: { id: { in: [KIT_ID] }, organizationId: "org-1" },
    });
    expect(mockFrom).toHaveBeenCalledWith("kits");
    expect(removedPaths()).toEqual([OWN_PATH]);
  });

  it("keeps a stored image that lies outside the kit's own folder", async () => {
    storedKit(signedKitUrl(OTHER_PATH));

    const response = await action(actionArgs(deleteRequest({})));

    expect((response as Response).status).toBe(302);
    expect(dbMocks.kitDeleteMany).toHaveBeenCalled();
    expect(removedPaths()).toEqual([]);
    expect(Logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        cause: expect.objectContaining({
          message: "Refused to delete a kit image outside the kit's own folder",
        }),
      })
    );
  });

  it("removes nothing from storage for a kit without an image", async () => {
    storedKit(null);

    await action(
      actionArgs(deleteRequest({ image: signedKitUrl(OTHER_PATH) }))
    );

    expect(dbMocks.kitDeleteMany).toHaveBeenCalled();
    expect(removedPaths()).toEqual([]);
  });
});
