/**
 * Deleting an asset from the phone removes its stored photo files, also when
 * someone else uploaded the photo. Runs the route and `deleteAsset` for real;
 * only the database, storage and the auth gates are stubbed.
 *
 * @see {@link file://../../../../app/routes/api+/mobile+/asset.delete.ts}
 * @see {@link file://../../../../app/modules/asset/image-files.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assetImageStorage,
  settleBackgroundWork,
} from "@mocks/asset-image-storage";

// @vitest-environment node

// why: no database in unit tests; the transaction callback runs against the
// same stubs, and the raw file lookups go to the storage fake
const dbMocks = vi.hoisted(() => ({
  asset: { delete: vi.fn() },
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
}));

vi.mock("~/database/db.server", () => ({ db: dbMocks }));

// why: removing objects is an HTTP call to Supabase storage; the fake records
// which paths each request removes
vi.mock("~/integrations/supabase/client", async () => ({
  getSupabaseAdmin: (await import("@mocks/asset-image-storage"))
    .assetImageStorage.getSupabaseAdmin,
}));

// why: the gates verify a Supabase token and read memberships; the phone user
// is a member allowed to delete
vi.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vi.fn(async () => ({ user: { id: "phone-user-2" } })),
  requireOrganizationAccess: vi.fn(async () => "org-1"),
  requireMobilePermission: vi.fn(async () => undefined),
}));

// why: ASSET_DELETED events have their own suite; here they only need to
// resolve inside the delete transaction
vi.mock("~/modules/activity-event/service.server", () => ({
  recordEvent: vi.fn(),
  recordEvents: vi.fn(),
}));

const { action } = await import("~/routes/api+/mobile+/asset.delete");
const { Logger } = await import("~/utils/logger");

/** Posts `{ assetId }` to the route as the phone app does. */
async function deleteFromPhone(assetId: string) {
  const request = new Request(
    "http://localhost/api/mobile/asset/delete?orgId=org-1",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetId }),
    }
  );
  const result = await action({ request, params: {}, context: {} } as never);
  const { data, init } = result as unknown as {
    data: { success?: boolean; error?: { message: string } };
    init: ResponseInit | null;
  };
  return { body: data, status: init?.status ?? 200 };
}

// why: Logger.error writes to the console and Sentry; spy on it to assert a
// storage failure is logged without producing output
let loggerErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  assetImageStorage.reset();
  loggerErrorSpy = vi.spyOn(Logger, "error").mockImplementation(() => {});
  dbMocks.$queryRaw.mockImplementation(assetImageStorage.queryRaw);
  dbMocks.$transaction.mockImplementation(
    (cb: (tx: typeof dbMocks) => Promise<unknown>) => cb(dbMocks)
  );
  dbMocks.asset.delete.mockResolvedValue({ reminders: [] });
});

describe("POST /api/mobile/asset/delete: photo files", () => {
  it("removes the photo files another user uploaded", async () => {
    assetImageStorage.upload(
      "web-user-1/asset-1/main-image-100.jpg",
      "web-user-1/asset-1/main-image-100-thumbnail.jpg"
    );

    const { body, status } = await deleteFromPhone("asset-1");
    await settleBackgroundWork();

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(assetImageStorage.storedFiles()).toEqual([]);
  });

  it("still reports success when storage fails", async () => {
    assetImageStorage.upload("web-user-1/asset-1/main-image-100.jpg");
    assetImageStorage.remove.mockRejectedValueOnce(new Error("Bad gateway"));

    const { body, status } = await deleteFromPhone("asset-1");
    await settleBackgroundWork();

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
  });
});
