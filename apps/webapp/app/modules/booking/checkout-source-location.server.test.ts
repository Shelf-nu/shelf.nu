/**
 * `recordCheckoutSourceLocations` against an in-memory transaction.
 *
 * The fake holds real rows and applies the same filters the service asks for
 * (slice ids, the organization, manual placements only, `checkedOutQuantity`
 * still 0), so a location from another workspace is simply not there, exactly
 * as it is not there for the real query. CI has no database, so this is where
 * the check-out side of the rule is proven end to end in one process.
 *
 * @see {@link file://./checkout-source-location.server.ts}
 */

import { AssetType } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { ShelfError } from "~/utils/error";

import { sourceSubmissionFromRecord } from "./checkout-source-location";
import { recordCheckoutSourceLocations } from "./checkout-source-location.server";

// why: the module imports `db` for its read-only loaders; the function under
// test only ever uses the transaction it is handed, so the root client must
// never be reached.
vi.mock("~/database/db.server", () => ({ db: {} }));

const ORG = "org-1";
const OTHER_ORG = "org-2";

type Slice = {
  id: string;
  assetId: string;
  assetKitId: string | null;
  checkedOutQuantity: number;
  sourceLocationId: string | null;
  organizationId: string;
};

type Placement = {
  id: string;
  assetId: string;
  locationId: string;
  quantity: number;
  organizationId: string;
  assetKitId: string | null;
  name: string;
};

/** The filter shapes the service sends; nothing else is understood. */
type SliceWhere = {
  id: { in: string[] };
  checkedOutQuantity?: number;
  booking: { organizationId: string };
  asset?: { type: AssetType; organizationId: string };
};
type IdsWhere = { id: { in: string[] }; organizationId?: string };
type PlacementWhere = {
  assetId: { in: string[] };
  organizationId: string;
  assetKitId: null;
};

/** A settled promise, the shape every Prisma delegate call returns. */
const resolved = <T>(value: T) => Promise.resolve(value);

/**
 * An in-memory stand-in for the four delegates the service reads and writes.
 * Only the filter shapes the service uses are understood.
 */
function fakeTx({
  slices,
  placements,
  assets,
  kitLocationByMembership = {},
  custody = [],
}: {
  slices: Slice[];
  placements: Placement[];
  assets: Array<{
    id: string;
    title: string;
    quantity: number;
    type: AssetType;
    organizationId: string;
  }>;
  kitLocationByMembership?: Record<string, string | null>;
  /** Operator custody rows: `locationId` is where the units were taken from. */
  custody?: Array<{
    assetId: string;
    locationId: string | null;
    quantity: number;
  }>;
}) {
  const assetById = new Map(assets.map((a) => [a.id, a]));
  return {
    bookingAsset: {
      findMany: vi.fn(({ where }: { where: SliceWhere }) =>
        resolved(
          slices
            .filter((s) => where.id.in.includes(s.id))
            .filter(
              (s) =>
                where.checkedOutQuantity === undefined ||
                s.checkedOutQuantity === where.checkedOutQuantity
            )
            .filter((s) => s.organizationId === where.booking.organizationId)
            .filter((s) => {
              const asset = assetById.get(s.assetId);
              return (
                !where.asset ||
                (asset?.type === where.asset.type &&
                  asset.organizationId === where.asset.organizationId)
              );
            })
            .map(({ id, assetId, assetKitId }) => ({ id, assetId, assetKitId }))
        )
      ),
      updateMany: vi.fn(
        ({
          where,
          data,
        }: {
          where: SliceWhere;
          data: { sourceLocationId: string | null };
        }) => {
          for (const s of slices) {
            if (
              where.id.in.includes(s.id) &&
              s.organizationId === where.booking.organizationId
            ) {
              s.sourceLocationId = data.sourceLocationId;
            }
          }
          return resolved({ count: where.id.in.length });
        }
      ),
    },
    assetKit: {
      findMany: vi.fn(({ where }: { where: IdsWhere }) =>
        resolved(
          where.id.in.map((id: string) => ({ id, kitId: `kit-of-${id}` }))
        )
      ),
    },
    custody: {
      findMany: vi.fn(({ where }: { where: { assetId: { in: string[] } } }) =>
        resolved(
          custody.filter((row) => where.assetId.in.includes(row.assetId))
        )
      ),
    },
    kit: {
      findMany: vi.fn(({ where }: { where: IdsWhere }) =>
        resolved(
          where.id.in.map((kitId: string) => ({
            id: kitId,
            locationId:
              kitLocationByMembership[kitId.replace("kit-of-", "")] ?? null,
          }))
        )
      ),
    },
    asset: {
      findMany: vi.fn(({ where }: { where: IdsWhere }) =>
        resolved(
          assets
            .filter((a) => where.id.in.includes(a.id))
            .filter((a) => a.organizationId === where.organizationId)
            .map(({ id, title, quantity }) => ({
              id,
              title,
              quantity,
              unitOfMeasure: "pcs",
            }))
        )
      ),
    },
    assetLocation: {
      findMany: vi.fn(({ where }: { where: PlacementWhere }) =>
        resolved(
          placements
            .filter((p) => where.assetId.in.includes(p.assetId))
            .filter((p) => p.organizationId === where.organizationId)
            .filter((p) => p.assetKitId === where.assetKitId)
            .map((p) => ({
              assetId: p.assetId,
              locationId: p.locationId,
              quantity: p.quantity,
              location: { name: p.name },
            }))
        )
      ),
    },
  };
}

/** A 60 + 40 pool at two locations with one slice about to go out. */
function scenario(
  overrides: Partial<Slice> = {},
  custody: Array<{
    assetId: string;
    locationId: string | null;
    quantity: number;
  }> = []
) {
  const slice: Slice = {
    id: "ba-1",
    assetId: "pool-1",
    assetKitId: null,
    checkedOutQuantity: 0,
    sourceLocationId: null,
    organizationId: ORG,
    ...overrides,
  };
  const placements: Placement[] = [
    {
      id: "al-camera",
      assetId: "pool-1",
      locationId: "loc-camera",
      quantity: 60,
      organizationId: ORG,
      assetKitId: null,
      name: "Camera Room",
    },
    {
      id: "al-studio",
      assetId: "pool-1",
      locationId: "loc-studio",
      quantity: 40,
      organizationId: ORG,
      assetKitId: null,
      name: "Studio",
    },
    // A location in another workspace, holding the same asset id: the
    // org-scoped read must never see it.
    {
      id: "al-foreign",
      assetId: "pool-1",
      locationId: "loc-foreign",
      quantity: 5,
      organizationId: OTHER_ORG,
      assetKitId: null,
      name: "Elsewhere",
    },
  ];
  const tx = fakeTx({
    slices: [slice],
    placements,
    assets: [
      {
        id: "pool-1",
        title: "AA Batteries",
        quantity: 100,
        type: AssetType.QUANTITY_TRACKED,
        organizationId: ORG,
      },
    ],
    kitLocationByMembership: { "ak-1": "loc-kit-shelf" },
    custody,
  });
  return { slice, tx };
}

describe("recordCheckoutSourceLocations", () => {
  it("records the picked location on the slice", async () => {
    const { slice, tx } = scenario();

    await recordCheckoutSourceLocations(tx as never, {
      organizationId: ORG,
      sliceIds: [slice.id],
      submission: sourceSubmissionFromRecord({ "ba-1": "loc-studio" }),
    });

    expect(slice.sourceLocationId).toBe("loc-studio");
  });

  it("accepts the answer keyed by asset id, for a slice added in the same request", async () => {
    const { slice, tx } = scenario();

    await recordCheckoutSourceLocations(tx as never, {
      organizationId: ORG,
      sliceIds: [slice.id],
      submission: sourceSubmissionFromRecord({ "pool-1": "loc-studio" }),
    });

    expect(slice.sourceLocationId).toBe("loc-studio");
  });

  it("records the most-left location when an old app sends nothing", async () => {
    const { slice, tx } = scenario();

    const decisions = await recordCheckoutSourceLocations(tx as never, {
      organizationId: ORG,
      sliceIds: [slice.id],
    });

    expect(slice.sourceLocationId).toBe("loc-camera");
    expect(decisions.get("ba-1")).toEqual({
      action: "record",
      locationId: "loc-camera",
      reason: "most-left",
    });
  });

  it("goes by units left: custody taken from a location lowers what it can give", async () => {
    // Camera Room holds 60 but 45 of them are in custody from there, so
    // Studio (40 placed, none in custody) has more left.
    const { slice, tx } = scenario({}, [
      { assetId: "pool-1", locationId: "loc-camera", quantity: 45 },
    ]);

    await recordCheckoutSourceLocations(tx as never, {
      organizationId: ORG,
      sliceIds: [slice.id],
    });

    expect(slice.sourceLocationId).toBe("loc-studio");
  });

  it("records nothing for an explicit Unplaced", async () => {
    const { slice, tx } = scenario({ sourceLocationId: null });

    await recordCheckoutSourceLocations(tx as never, {
      organizationId: ORG,
      sliceIds: [slice.id],
      submission: sourceSubmissionFromRecord({ "ba-1": null }),
    });

    expect(slice.sourceLocationId).toBeNull();
  });

  it("refuses a location from another workspace with a 400 and writes nothing", async () => {
    const { slice, tx } = scenario();

    const attempt = recordCheckoutSourceLocations(tx as never, {
      organizationId: ORG,
      sliceIds: [slice.id],
      submission: sourceSubmissionFromRecord({ "ba-1": "loc-foreign" }),
    });

    await expect(attempt).rejects.toBeInstanceOf(ShelfError);
    await expect(attempt).rejects.toMatchObject({ status: 400 });
    expect(tx.bookingAsset.updateMany).not.toHaveBeenCalled();
    expect(slice.sourceLocationId).toBeNull();
  });

  it("refuses a location the pool is not placed at", async () => {
    const { slice, tx } = scenario();

    await expect(
      recordCheckoutSourceLocations(tx as never, {
        organizationId: ORG,
        sliceIds: [slice.id],
        submission: sourceSubmissionFromRecord({ "ba-1": "loc-made-up" }),
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("keeps the source of a slice that already went out", async () => {
    const { slice, tx } = scenario({
      checkedOutQuantity: 4,
      sourceLocationId: "loc-studio",
    });

    await recordCheckoutSourceLocations(tx as never, {
      organizationId: ORG,
      sliceIds: [slice.id],
      submission: sourceSubmissionFromRecord({ "ba-1": "loc-camera" }),
    });

    expect(slice.sourceLocationId).toBe("loc-studio");
    expect(tx.bookingAsset.updateMany).not.toHaveBeenCalled();
  });

  it("records the kit's location for a kit slice and never reads placements for it", async () => {
    const { slice, tx } = scenario({ assetKitId: "ak-1" });

    await recordCheckoutSourceLocations(tx as never, {
      organizationId: ORG,
      sliceIds: [slice.id],
      submission: sourceSubmissionFromRecord({ "ba-1": "loc-studio" }),
    });

    expect(slice.sourceLocationId).toBe("loc-kit-shelf");
    expect(tx.assetLocation.findMany).not.toHaveBeenCalled();
  });

  it("ignores a slice from another workspace", async () => {
    const { slice, tx } = scenario({ organizationId: OTHER_ORG });

    const decisions = await recordCheckoutSourceLocations(tx as never, {
      organizationId: ORG,
      sliceIds: [slice.id],
      submission: sourceSubmissionFromRecord({ "ba-1": "loc-camera" }),
    });

    expect(decisions.size).toBe(0);
    expect(slice.sourceLocationId).toBeNull();
  });
});
