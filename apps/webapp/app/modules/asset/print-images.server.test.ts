/**
 * Tests for `signAssetPhotosForPrint`: the read-only, uncapped photo signer the
 * printable sheets use so every row prints its photo.
 *
 * @see {@link file://./print-images.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import { Logger } from "~/utils/logger";
import { signAssetPhotosForPrint } from "./print-images.server";

// why: the Supabase admin client signs over HTTP; stub `createSignedUrls` so
// the tests stay offline and can assert the paths sent in each request.
const { createSignedUrlsMock, storageFromMock } = vi.hoisted(() => {
  const createSignedUrlsMock = vi.fn();
  return {
    createSignedUrlsMock,
    storageFromMock: vi.fn(() => ({ createSignedUrls: createSignedUrlsMock })),
  };
});
vi.mock("~/integrations/supabase/client", () => ({
  getSupabaseAdmin: () => ({ storage: { from: storageFromMock } }),
}));

// why: a spy on the asset write the persisting re-sign performs, so the suite
// can prove printing never writes back.
vi.mock("~/database/db.server", () => ({
  db: { asset: { update: vi.fn(), updateMany: vi.fn() } },
}));

const STORAGE = "https://project.supabase.co/storage/v1/object/sign/assets";
const PAST = new Date("2020-01-01T00:00:00.000Z");
const FUTURE = new Date("2999-01-01T00:00:00.000Z");

/** A sheet row whose stored photo URL points at `path` in the assets bucket. */
function row(
  id: string,
  {
    expiration = PAST,
    thumbnail = true,
  }: { expiration?: Date | null; thumbnail?: boolean } = {}
) {
  return {
    id,
    title: `Asset ${id}`,
    mainImage: `${STORAGE}/org-1/${id}/main.jpg?token=old`,
    mainImageExpiration: expiration,
    thumbnailImage: thumbnail
      ? `${STORAGE}/org-1/${id}/thumb.jpg?token=old`
      : null,
  };
}

/** Storage's answer for a request: a fresh URL per path, in request order. */
function signEverything(paths: string[]) {
  return Promise.resolve({
    data: paths.map((path) => ({
      path,
      error: null,
      signedUrl: `https://signed/${path}`,
    })),
    error: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  createSignedUrlsMock.mockImplementation(signEverything);
});

describe("signAssetPhotosForPrint", () => {
  it("signs the main image and thumbnail of a lapsed row in one bulk call", async () => {
    const [signed] = await signAssetPhotosForPrint([row("a1")], {
      organizationId: "org-1",
    });

    expect(storageFromMock).toHaveBeenCalledWith("assets");
    expect(createSignedUrlsMock).toHaveBeenCalledTimes(1);
    expect(createSignedUrlsMock).toHaveBeenCalledWith(
      ["org-1/a1/main.jpg", "org-1/a1/thumb.jpg"],
      3600
    );
    expect(signed.mainImage).toBe("https://signed/org-1/a1/main.jpg");
    expect(signed.thumbnailImage).toBe("https://signed/org-1/a1/thumb.jpg");
    // The row keeps everything else it came with.
    expect(signed.title).toBe("Asset a1");
  });

  it("leaves fresh rows and rows without a photo untouched, in input order", async () => {
    const fresh = row("fresh", { expiration: FUTURE });
    const noPhoto = { ...row("none"), mainImage: null };
    const lapsed = row("lapsed", { thumbnail: false });

    const result = await signAssetPhotosForPrint([fresh, noPhoto, lapsed], {
      organizationId: "org-1",
    });

    expect(result[0]).toBe(fresh);
    expect(result[1]).toBe(noPhoto);
    expect(result[2].mainImage).toBe("https://signed/org-1/lapsed/main.jpg");
    expect(result[2].thumbnailImage).toBeNull();
    expect(createSignedUrlsMock).toHaveBeenCalledWith(
      ["org-1/lapsed/main.jpg"],
      3600
    );
  });

  it("makes no storage call when nothing has lapsed", async () => {
    const rows = [row("a1", { expiration: FUTURE })];

    const result = await signAssetPhotosForPrint(rows, {
      organizationId: "org-1",
    });

    expect(result).toBe(rows);
    expect(createSignedUrlsMock).not.toHaveBeenCalled();
  });

  it("signs a repeated asset once and applies it to every row carrying it", async () => {
    // One asset across two booking slices.
    const result = await signAssetPhotosForPrint([row("a1"), row("a1")], {
      organizationId: "org-1",
    });

    expect(createSignedUrlsMock.mock.calls[0][0]).toHaveLength(2);
    expect(result.map((r) => r.mainImage)).toEqual([
      "https://signed/org-1/a1/main.jpg",
      "https://signed/org-1/a1/main.jpg",
    ]);
  });

  it("never writes the signed URLs back to the asset", async () => {
    await signAssetPhotosForPrint([row("a1"), row("a2")], {
      organizationId: "org-1",
    });

    expect(db.asset.updateMany).not.toHaveBeenCalled();
    expect(db.asset.update).not.toHaveBeenCalled();
  });

  it("signs every row of a large sheet, in chunks of 500 paths", async () => {
    // 300 rows with a thumbnail each = 600 paths, so two chunks.
    const rows = Array.from({ length: 300 }, (_, i) => row(`a${i}`));

    const result = await signAssetPhotosForPrint(rows, {
      organizationId: "org-1",
    });

    expect(createSignedUrlsMock).toHaveBeenCalledTimes(2);
    expect(createSignedUrlsMock.mock.calls[0][0]).toHaveLength(500);
    expect(createSignedUrlsMock.mock.calls[1][0]).toHaveLength(100);
    expect(result.every((r) => r.mainImage.startsWith("https://signed/"))).toBe(
      true
    );
    expect(result[299].mainImage).toBe("https://signed/org-1/a299/main.jpg");
  });

  it("returns the rows unchanged and logs when storage fails", async () => {
    const errorSpy = vi.spyOn(Logger, "error").mockImplementation(() => {});
    createSignedUrlsMock.mockResolvedValue({
      data: null,
      error: new Error("storage down"),
    });
    const rows = [row("a1"), row("a2")];

    const result = await signAssetPhotosForPrint(rows, {
      organizationId: "org-1",
    });

    expect(result).toEqual(rows);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it("does not throw when the storage call itself rejects", async () => {
    const errorSpy = vi.spyOn(Logger, "error").mockImplementation(() => {});
    createSignedUrlsMock.mockRejectedValue(new Error("network"));
    const rows = [row("a1")];

    await expect(
      signAssetPhotosForPrint(rows, { organizationId: "org-1" })
    ).resolves.toEqual(rows);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it("keeps the stored URL for a path storage refused, and signs the rest", async () => {
    const errorSpy = vi.spyOn(Logger, "error").mockImplementation(() => {});
    createSignedUrlsMock.mockImplementation((paths: string[]) =>
      Promise.resolve({
        data: paths.map((path) =>
          path.startsWith("org-1/gone/")
            ? { path, error: "Object not found", signedUrl: null }
            : { path, error: null, signedUrl: `https://signed/${path}` }
        ),
        error: null,
      })
    );
    const gone = row("gone");

    const [missing, present] = await signAssetPhotosForPrint(
      [gone, row("a1")],
      { organizationId: "org-1" }
    );

    expect(missing).toEqual(gone);
    expect(present.mainImage).toBe("https://signed/org-1/a1/main.jpg");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });
});
