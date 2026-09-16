/**
 * Unit test for the mobile image repair the read paths share.
 *
 * A mobile row carries the asset's own signed URL, which stops loading once
 * `mainImageExpiration` passes. The companion never repairs one, so every
 * mobile read path hands its rows to `refreshExpiredMobileAssetImages` first.
 * What that has to guarantee:
 *
 * 1. A lapsed URL comes back re-signed, with a fresh expiry, and the row keeps
 *    every other field it was selected with.
 * 2. A URL that has not lapsed is left exactly as it was, with no signing call.
 * 3. A row selected without `thumbnailImage` does not grow the key, so a
 *    response shape never changes just because its photo was repaired.
 * 4. The write-back is scoped to the workspace the caller named, which for a
 *    cross-workspace scan is the one that OWNS the asset.
 *
 * The real `refreshExpiredAssetImages` runs underneath; only storage and the
 * database are stubbed, so this exercises the whole repair.
 *
 * @see {@link file://./mobile-asset-images.server.ts}
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import {
  refreshExpiredMobileAssetImage,
  refreshExpiredMobileAssetImages,
} from "~/modules/api/mobile-asset-images.server";
import { ASSET_IMAGE_RESIGNS_PER_RESPONSE } from "~/modules/asset/service.server";
import type * as StorageServer from "~/utils/storage.server";
import { createSignedUrl } from "~/utils/storage.server";

// @vitest-environment node

// why: the write-back of a re-signed URL is the database boundary this test
// observes, so the one delegate the repair writes through is stubbed.
vi.mock("~/database/db.server", () => ({
  db: {
    asset: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  },
}));

// why: signing is a Supabase Storage network call. Only `createSignedUrl` is
// replaced; the rest of the module stays real so nothing else changes silently.
vi.mock("~/utils/storage.server", async () => {
  const actual = await vi.importActual<typeof StorageServer>(
    "~/utils/storage.server"
  );
  return {
    ...actual,
    createSignedUrl: vi.fn(({ filename }: { filename: string }) =>
      Promise.resolve(`https://storage.test/sign/assets/${filename}?token=new`)
    ),
  };
});

const createSignedUrlMock = vi.mocked(createSignedUrl);
const updateManyMock = vi.mocked(db.asset.updateMany);

/** Lets the helper's fire-and-forget write-back settle before asserting. */
async function flushBackgroundWrites() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const LAPSED = "https://storage.test/sign/assets/org-1/cam.png?token=old";
const LAPSED_THUMB =
  "https://storage.test/sign/assets/org-1/cam-thumb.png?token=old";

/** A row whose photo lapsed long ago, as a mobile select returns it. */
function lapsedRow() {
  return {
    id: "asset-1",
    title: "Camera",
    mainImage: LAPSED,
    thumbnailImage: LAPSED_THUMB,
    mainImageExpiration: new Date("2020-01-01T00:00:00.000Z"),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("refreshExpiredMobileAssetImages", () => {
  it("re-signs a lapsed photo and keeps the rest of the row", async () => {
    const [row] = await refreshExpiredMobileAssetImages(
      [{ ...lapsedRow(), category: { name: "Cameras" } }],
      "org-1"
    );

    expect(row.mainImage).toBe(
      "https://storage.test/sign/assets/org-1/cam.png?token=new"
    );
    expect(row.thumbnailImage).toBe(
      "https://storage.test/sign/assets/org-1/cam-thumb.png?token=new"
    );
    // A fresh expiry, so the next read does not re-sign the same row again.
    expect(row.mainImageExpiration!.getTime()).toBeGreaterThan(Date.now());
    // Everything the caller selected survives the repair.
    expect(row.title).toBe("Camera");
    expect(row.category).toEqual({ name: "Cameras" });
  });

  it("leaves a photo that has not lapsed untouched", async () => {
    const fresh = {
      id: "asset-2",
      mainImage: "https://storage.test/sign/assets/org-1/live.png?token=live",
      thumbnailImage: null,
      mainImageExpiration: new Date(Date.now() + 60 * 60 * 1000),
    };

    const [row] = await refreshExpiredMobileAssetImages([fresh], "org-1");

    expect(row).toBe(fresh);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it("does not add a thumbnail the caller never selected", async () => {
    const { thumbnailImage: _thumbnailImage, ...withoutThumbnail } =
      lapsedRow();

    const [row] = await refreshExpiredMobileAssetImages(
      [withoutThumbnail],
      "org-1"
    );

    expect(row.mainImage).toContain("token=new");
    expect(Object.prototype.hasOwnProperty.call(row, "thumbnailImage")).toBe(
      false
    );
  });

  it("writes the new URL back to the workspace it was given", async () => {
    // A scanner resolve can hand back an asset owned by a sibling workspace,
    // so the guard has to name that workspace rather than the caller's.
    await refreshExpiredMobileAssetImages([lapsedRow()], "org-owning");
    await flushBackgroundWrites();

    expect(updateManyMock).toHaveBeenCalledTimes(1);
    const [args] = updateManyMock.mock.calls[0];
    expect(args.where).toMatchObject({
      id: "asset-1",
      organizationId: "org-owning",
      // Guarded on the URL that was read, so a photo replaced meanwhile is
      // never clobbered by this deferred write.
      mainImage: LAPSED,
    });
  });

  it("repairs one response's worth of rows, first rows first", async () => {
    // A booking or audit bigger than the cap: the rows past it keep their
    // stored URL for now and are repaired on the next open.
    const rows = Array.from(
      { length: ASSET_IMAGE_RESIGNS_PER_RESPONSE + 2 },
      (_, index) => ({ ...lapsedRow(), id: `asset-${index}` })
    );

    const result = await refreshExpiredMobileAssetImages(rows, "org-1");

    const repaired = result.filter((row) =>
      row.mainImage.includes("token=new")
    );
    expect(repaired).toHaveLength(ASSET_IMAGE_RESIGNS_PER_RESPONSE);
    expect(result[0].mainImage).toContain("token=new");
    expect(result[result.length - 1].mainImage).toBe(LAPSED);
  });

  it("signs nothing for an empty page", async () => {
    await expect(refreshExpiredMobileAssetImages([], "org-1")).resolves.toEqual(
      []
    );
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });
});

describe("refreshExpiredMobileAssetImage", () => {
  it("returns a scanned row with the keys it came in with when nothing lapsed", async () => {
    // Shaped like a scanner row whose select carries no expiry.
    const scanned = {
      id: "asset-3",
      title: "Tripod",
      mainImage: "https://storage.test/sign/assets/org-1/tripod.png?token=x",
      thumbnailImage: null,
    };

    const row = await refreshExpiredMobileAssetImage(scanned, "org-1");

    expect(row).toBe(scanned);
    expect(Object.keys(row)).toEqual([
      "id",
      "title",
      "mainImage",
      "thumbnailImage",
    ]);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it("repairs a lapsed scanned photo", async () => {
    const row = await refreshExpiredMobileAssetImage(lapsedRow(), "org-1");

    expect(row.mainImage).toContain("token=new");
    expect(row.thumbnailImage).toContain("token=new");
    expect(row.title).toBe("Camera");
  });
});
