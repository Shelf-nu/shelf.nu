/**
 * Deleting an asset from its page removes its stored photo files, also when
 * someone else uploaded the photo. Runs the action and `deleteAsset` for real;
 * only the database, storage and the permission gate are stubbed.
 *
 * @see {@link file://../../../app/routes/_layout+/assets.$assetId.tsx}
 * @see {@link file://../../../app/modules/asset/image-files.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assetImageStorage,
  settleBackgroundWork,
  signedAssetUrl,
} from "@mocks/asset-image-storage";
import { createActionArgs } from "@mocks/remix";

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

// why: the gate reads memberships; the deleting user is allowed to delete
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(async () => ({ organizationId: "org-1" })),
}));

// why: ASSET_DELETED events have their own suite; here they only need to
// resolve inside the delete transaction
vi.mock("~/modules/activity-event/service.server", () => ({
  recordEvent: vi.fn(),
  recordEvents: vi.fn(),
}));

// why: the route's modules report through Sentry at import and on error;
// no reporting is under test
vi.mock("@sentry/react-router", () => ({
  setUser: vi.fn(),
  setTag: vi.fn(),
  captureException: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// why: the route transitively imports the scanner success animation, and
// lottie-web touches canvas APIs at import that happy-dom does not provide;
// only the action runs here
vi.mock("lottie-react", () => ({ default: () => null }));

const { action } = await import("~/routes/_layout+/assets.$assetId");

/**
 * Submits the page's delete form as `deleter-2`.
 *
 * why: a `URLSearchParams` body rather than `FormData`, which happy-dom can
 * alter on the `Request` round-trip.
 */
function submitDelete(assetId: string) {
  return action(
    createActionArgs({
      params: { assetId },
      context: { getSession: () => ({ userId: "deleter-2" }) } as never,
      request: new Request(`http://localhost/assets/${assetId}`, {
        method: "POST",
        body: new URLSearchParams({
          intent: "delete",
          mainImageUrl: signedAssetUrl(
            `uploader-1/${assetId}/main-image-100.jpg`
          ),
        }),
      }),
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  assetImageStorage.reset();
  dbMocks.$queryRaw.mockImplementation(assetImageStorage.queryRaw);
  dbMocks.$transaction.mockImplementation(
    (cb: (tx: typeof dbMocks) => Promise<unknown>) => cb(dbMocks)
  );
  dbMocks.asset.delete.mockResolvedValue({ reminders: [] });
});

describe("asset page delete: photo files", () => {
  it("removes the photo files another user uploaded and redirects", async () => {
    assetImageStorage.upload(
      "uploader-1/asset-1/main-image-100.jpg",
      "uploader-1/asset-1/main-image-100-thumbnail.jpg"
    );

    const response = (await submitDelete("asset-1")) as Response;
    await settleBackgroundWork();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/assets");
    expect(assetImageStorage.storedFiles()).toEqual([]);
  });
});
