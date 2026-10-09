/**
 * Deleting an asset removes its stored photo files, whoever uploaded them:
 * the single delete (web and phone go through `deleteAsset`) and the bulk
 * delete. The cleanup runs after the delete commits and never fails it.
 *
 * @see {@link file://./image-files.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assetImageStorage,
  settleBackgroundWork,
  signedAssetUrl,
} from "@mocks/asset-image-storage";
import { Logger } from "~/utils/logger";
import { bulkDeleteAssets, deleteAsset } from "./service.server";

// why: exercise the delete flows without a database; the transaction callback
// runs against the same stubs, and the raw lookups go to the storage fake
const dbMocks = vi.hoisted(() => ({
  asset: {
    delete: vi.fn(),
    deleteMany: vi.fn(),
    findMany: vi.fn(),
  },
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

// why: ASSET_DELETED events have their own suite; here they only need to
// resolve inside the delete transaction
vi.mock("~/modules/activity-event/service.server", () => ({
  recordEvent: vi.fn(),
  recordEvents: vi.fn(),
}));

// why: select-all id resolution has its own suite; echo the selected ids
vi.mock("./bulk-operations-helper.server", () => ({
  resolveAssetIdsForBulkOperation: vi.fn(
    ({ assetIds }: { assetIds: string[] }) => Promise.resolve(assetIds)
  ),
}));

// why: Logger.error writes to the console and Sentry; spy on it to assert a
// failure is logged without producing output
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
  dbMocks.asset.deleteMany.mockResolvedValue({ count: 0 });
});

describe("deleteAsset", () => {
  it("removes the photo files uploaded by someone other than the deleting user", async () => {
    assetImageStorage.upload(
      "uploader-1/asset-1/main-image-100.jpg",
      "uploader-1/asset-1/main-image-100-thumbnail.jpg"
    );

    await deleteAsset({
      id: "asset-1",
      organizationId: "org-1",
      actorUserId: "deleter-2",
    });
    await settleBackgroundWork();

    expect(assetImageStorage.storedFiles()).toEqual([]);
    // The files are only looked up once the row is gone.
    expect(dbMocks.asset.delete.mock.invocationCallOrder[0]).toBeLessThan(
      assetImageStorage.queryRaw.mock.invocationCallOrder[0]
    );
  });

  it("keeps a file another asset still shows", async () => {
    assetImageStorage.upload(
      "uploader-1/asset-1/main-image-100.jpg",
      "uploader-1/asset-1/main-image-101.jpg"
    );
    assetImageStorage.setRemainingAssets([
      {
        mainImage: signedAssetUrl("uploader-1/asset-1/main-image-101.jpg"),
        thumbnailImage: null,
      },
    ]);

    await deleteAsset({ id: "asset-1", organizationId: "org-1" });
    await settleBackgroundWork();

    expect(assetImageStorage.storedFiles()).toEqual([
      "uploader-1/asset-1/main-image-101.jpg",
    ]);
  });

  it("succeeds and logs when storage refuses the removal", async () => {
    assetImageStorage.upload("uploader-1/asset-1/main-image-100.jpg");
    assetImageStorage.remove.mockRejectedValueOnce(new Error("Bad gateway"));

    await expect(
      deleteAsset({ id: "asset-1", organizationId: "org-1" })
    ).resolves.toBeUndefined();
    await settleBackgroundWork();

    expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
  });

  it("removes nothing when the delete itself fails", async () => {
    assetImageStorage.upload("uploader-1/asset-1/main-image-100.jpg");
    dbMocks.asset.delete.mockRejectedValueOnce(new Error("Record not found"));

    await expect(
      deleteAsset({ id: "asset-1", organizationId: "org-1" })
    ).rejects.toThrow();
    await settleBackgroundWork();

    expect(assetImageStorage.queryRaw).not.toHaveBeenCalled();
    expect(assetImageStorage.storedFiles()).toEqual([
      "uploader-1/asset-1/main-image-100.jpg",
    ]);
  });
});

describe("bulkDeleteAssets", () => {
  /** Deletes the given assets as `deleter-2`. */
  function bulkDelete(assetIds: string[]) {
    return bulkDeleteAssets({
      assetIds,
      organizationId: "org-1",
      userId: "deleter-2",
      // why: only read by the mocked id resolution
      settings: {} as never,
    });
  }

  it("removes the photo files of every deleted asset, whoever uploaded them", async () => {
    dbMocks.asset.findMany.mockResolvedValue([
      { id: "asset-1", mainImage: signedAssetUrl("x"), title: "Drill" },
      { id: "asset-2", mainImage: signedAssetUrl("y"), title: "Saw" },
      { id: "asset-3", mainImage: null, title: "Tape" },
    ]);
    assetImageStorage.upload(
      "uploader-1/asset-1/main-image-100.jpg",
      "uploader-1/asset-1/main-image-100-thumbnail.jpg",
      "uploader-3/asset-2/main-image-200.jpg",
      // Not selected, so not deleted.
      "uploader-1/asset-9/main-image-900.jpg"
    );

    await bulkDelete(["asset-1", "asset-2", "asset-3"]);
    await settleBackgroundWork();

    expect(assetImageStorage.storedFiles()).toEqual([
      "uploader-1/asset-9/main-image-900.jpg",
    ]);
    // One lookup and one storage request for the whole selection.
    expect(assetImageStorage.remove).toHaveBeenCalledTimes(1);
  });

  it("succeeds and logs when the file lookup fails", async () => {
    dbMocks.asset.findMany.mockResolvedValue([
      { id: "asset-1", mainImage: signedAssetUrl("x"), title: "Drill" },
    ]);
    assetImageStorage.queryRaw.mockRejectedValueOnce(new Error("timeout"));

    await expect(bulkDelete(["asset-1"])).resolves.toBeUndefined();
    await settleBackgroundWork();

    expect(dbMocks.asset.deleteMany).toHaveBeenCalledTimes(1);
    expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
  });
});
