/**
 * Asset index data-loader tests
 *
 * Covers `attachKitNamesToBookingAssets`, the availability-view helper that
 * resolves the kit name onto each kit-driven `BookingAsset` slice. The function
 * has a cross-org security dimension (it org-scopes the `AssetKit` read per
 * .claude/rules/org-scope-user-supplied-ids) and mutates slices in place, so
 * these tests lock in: standalone slices are untouched, kit slices get the
 * resolved name/id, kit ids are deduped into ONE read, and a kit outside the
 * caller's org yields `kitName: null` rather than leaking a name.
 *
 * @see {@link file://./data.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import { attachKitNamesToBookingAssets } from "./data.server";

// why: the helper's only DB touch is `db.assetKit.findMany`; stub it so the
// unit test never hits Postgres and we can assert the org-scoped read shape.
vi.mock("~/database/db.server", () => ({
  db: {
    assetKit: {
      findMany: vi.fn(),
    },
  },
}));

/** Minimal in-place-mutable slice shape the helper reads/writes. */
type Slice = {
  assetKitId: string | null;
  kitId?: string | null;
  kitName?: string | null;
};

/** Casts loosely-typed test assets to the helper's expected input type. */
type Assets = Parameters<typeof attachKitNamesToBookingAssets>[0]["assets"];

const findManyMock = vi.mocked(db.assetKit.findMany);

describe("attachKitNamesToBookingAssets", () => {
  beforeEach(() => {
    findManyMock.mockReset();
  });

  it("resolves kit names on kit slices, leaves standalone slices untouched, and dedupes the read", async () => {
    findManyMock.mockResolvedValue([
      // why: Prisma's typed return is richer than the helper reads; only
      // `id` + `kit` matter, so a narrow object cast keeps the fixture small.
      { id: "ak1", kit: { id: "k1", name: "Kit One" } },
      { id: "ak2", kit: { id: "k2", name: "Kit Two" } },
    ] as never);

    // `ak1` appears on both assets — it must collapse to ONE id in the read.
    const assets = [
      {
        bookingAssets: [
          { assetKitId: null } satisfies Slice,
          { assetKitId: "ak1" } satisfies Slice,
        ],
      },
      {
        bookingAssets: [
          { assetKitId: "ak1" } satisfies Slice,
          { assetKitId: "ak2" } satisfies Slice,
        ],
      },
    ];

    await attachKitNamesToBookingAssets({
      assets: assets as unknown as Assets,
      organizationId: "org-1",
    });

    // Exactly one org-scoped read, with the deduped kit ids.
    expect(findManyMock).toHaveBeenCalledTimes(1);
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["ak1", "ak2"] }, organizationId: "org-1" },
      })
    );

    // Standalone slice is never mutated.
    const standalone = assets[0].bookingAssets[0] as Slice;
    expect(standalone.kitName).toBeUndefined();
    expect(standalone.kitId).toBeUndefined();

    // Kit slices carry the resolved name/id.
    const kitSliceA = assets[0].bookingAssets[1] as Slice;
    expect(kitSliceA.kitName).toBe("Kit One");
    expect(kitSliceA.kitId).toBe("k1");

    const kitSliceB = assets[1].bookingAssets[1] as Slice;
    expect(kitSliceB.kitName).toBe("Kit Two");
    expect(kitSliceB.kitId).toBe("k2");
  });

  it("yields kitName: null for a kit outside the caller's org (not leaked)", async () => {
    // The org-scoped read returns nothing for a kit that belongs to another
    // org, so the slice resolves to null rather than surfacing a foreign name.
    findManyMock.mockResolvedValue([] as never);

    const assets = [
      { bookingAssets: [{ assetKitId: "ak-other" } satisfies Slice] },
    ];

    await attachKitNamesToBookingAssets({
      assets: assets as unknown as Assets,
      organizationId: "org-1",
    });

    const slice = assets[0].bookingAssets[0] as Slice;
    expect(slice.kitName).toBeNull();
    expect(slice.kitId).toBeNull();
  });

  it("early-returns without a DB read when there are no kit slices", async () => {
    const assets = [
      { bookingAssets: [{ assetKitId: null } satisfies Slice] },
      { bookingAssets: [] },
      {},
    ];

    await attachKitNamesToBookingAssets({
      assets: assets as unknown as Assets,
      organizationId: "org-1",
    });

    expect(findManyMock).not.toHaveBeenCalled();
  });
});
