import { beforeEach, describe, expect, it, vi } from "vitest";
import { assetImageStorage, signedAssetUrl } from "@mocks/asset-image-storage";
import { Logger } from "~/utils/logger";
import { removeImageFilesOfDeletedAssets } from "./image-files.server";

// why: the cleanup reads `storage.objects` and `Asset` through raw SQL; the
// in-memory fake answers both so each test states its bucket and its rows
vi.mock("~/database/db.server", async () => ({
  db: {
    $queryRaw: (await import("@mocks/asset-image-storage")).assetImageStorage
      .queryRaw,
  },
}));

// why: removing objects is an HTTP call to Supabase storage; the fake records
// which paths each request removes
vi.mock("~/integrations/supabase/client", async () => ({
  getSupabaseAdmin: (await import("@mocks/asset-image-storage"))
    .assetImageStorage.getSupabaseAdmin,
}));

// why: Logger.error writes to the console and Sentry; spy on it to assert a
// failure is logged without producing output
let loggerErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  assetImageStorage.reset();
  loggerErrorSpy = vi.spyOn(Logger, "error").mockImplementation(() => {});
});

describe("removeImageFilesOfDeletedAssets", () => {
  it("removes every file in the deleted asset's folders, whoever uploaded it", async () => {
    assetImageStorage.upload(
      "uploader-a/asset-1/main-image-100.jpg",
      "uploader-a/asset-1/main-image-100-thumbnail.jpg",
      // A second user replaced the photo later.
      "uploader-b/asset-1/main-image-200.jpg",
      "uploader-b/asset-1/main-image-200-thumbnail.jpg",
      "uploader-a/asset-2/main-image-300.jpg"
    );
    assetImageStorage.setRemainingAssets([
      {
        mainImage: signedAssetUrl("uploader-a/asset-2/main-image-300.jpg"),
        thumbnailImage: null,
      },
    ]);

    await removeImageFilesOfDeletedAssets(["asset-1"]);

    expect(assetImageStorage.storedFiles()).toEqual([
      "uploader-a/asset-2/main-image-300.jpg",
    ]);
    // One storage request for all four files.
    expect(assetImageStorage.remove).toHaveBeenCalledTimes(1);
    expect(loggerErrorSpy).not.toHaveBeenCalled();
  });

  it("keeps a file that another asset still shows", async () => {
    assetImageStorage.upload(
      "uploader-a/asset-1/main-image-100.jpg",
      "uploader-a/asset-1/main-image-100-thumbnail.jpg",
      // Photo and thumbnail of asset-2, stored in asset-1's folder.
      "uploader-a/asset-1/main-image-101.jpg",
      "uploader-a/asset-1/main-image-101-thumbnail.jpg"
    );
    assetImageStorage.setRemainingAssets([
      {
        mainImage: signedAssetUrl("uploader-a/asset-1/main-image-101.jpg"),
        thumbnailImage: signedAssetUrl(
          "uploader-a/asset-1/main-image-101-thumbnail.jpg"
        ),
      },
    ]);

    await removeImageFilesOfDeletedAssets(["asset-1"]);

    expect(assetImageStorage.storedFiles()).toEqual([
      "uploader-a/asset-1/main-image-101-thumbnail.jpg",
      "uploader-a/asset-1/main-image-101.jpg",
    ]);
  });

  it("does nothing for an asset with no stored files", async () => {
    assetImageStorage.upload("uploader-a/asset-2/main-image-300.jpg");

    await removeImageFilesOfDeletedAssets(["asset-1"]);

    expect(assetImageStorage.remove).not.toHaveBeenCalled();
    // No files found, so the asset table is not read either.
    expect(assetImageStorage.queryRaw).toHaveBeenCalledTimes(1);
    expect(assetImageStorage.storedFiles()).toEqual([
      "uploader-a/asset-2/main-image-300.jpg",
    ]);
  });

  it("does nothing for an empty list", async () => {
    await removeImageFilesOfDeletedAssets([]);

    expect(assetImageStorage.queryRaw).not.toHaveBeenCalled();
    expect(assetImageStorage.remove).not.toHaveBeenCalled();
  });

  it("removes in requests of at most 1000 files and goes on after a failed one", async () => {
    const paths = Array.from(
      { length: 1001 },
      (_, i) => `uploader-a/asset-${i}/main-image-${i}.jpg`
    );
    assetImageStorage.upload(...paths);
    assetImageStorage.remove.mockResolvedValueOnce({
      data: null,
      error: new Error("Bad gateway"),
    } as never);

    await expect(
      removeImageFilesOfDeletedAssets(paths.map((path) => path.split("/")[1]))
    ).resolves.toBeUndefined();

    expect(
      assetImageStorage.remove.mock.calls.map(([chunk]) => chunk.length)
    ).toEqual([1000, 1]);
    // The failed request is logged by asset id, never by object key.
    expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
    const logged = loggerErrorSpy.mock.calls[0][0] as {
      additionalData: { assetIds: string[] };
    };
    expect(Array.isArray(logged.additionalData.assetIds)).toBe(true);
    expect(logged.additionalData.assetIds).toHaveLength(1000);
    expect(JSON.stringify(logged.additionalData)).not.toContain("main-image");
  });

  it("logs and resolves when the storage request throws", async () => {
    assetImageStorage.upload("uploader-a/asset-1/main-image-100.jpg");
    assetImageStorage.remove.mockRejectedValueOnce(new Error("socket hang up"));

    await expect(
      removeImageFilesOfDeletedAssets(["asset-1"])
    ).resolves.toBeUndefined();

    expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
  });

  it("logs and resolves when the lookup fails", async () => {
    assetImageStorage.queryRaw.mockRejectedValueOnce(
      new Error("permission denied for table objects")
    );

    await expect(
      removeImageFilesOfDeletedAssets(["asset-1"])
    ).resolves.toBeUndefined();

    expect(assetImageStorage.remove).not.toHaveBeenCalled();
    expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
  });

  it("reads the asset image columns by their database names", async () => {
    assetImageStorage.upload("uploader-a/asset-1/main-image-100.jpg");

    await removeImageFilesOfDeletedAssets(["asset-1"]);

    const sqlTexts = assetImageStorage.queryRaw.mock.calls.map(([strings]) =>
      strings.join("?")
    );
    expect(sqlTexts).toEqual([
      expect.stringContaining("FROM storage.objects"),
      expect.stringMatching(/"mainImage"[\s\S]*"thumbnailImage"/),
    ]);
  });
});
