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
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";

import {
  ALLOCATION_SOURCE_FORM_VALUE,
  parseSourceLocationsFromFormData,
  sourceLocationFieldName,
  sourceSubmissionFromRecord,
} from "./checkout-source-location";
import {
  dispatchCheckoutSources,
  getCheckoutSourceQuestions,
  loadPoolSourceSnapshots,
  recordCheckoutSourceLocations,
} from "./checkout-source-location.server";
import { dispatchUnits } from "./sources/booking-sources.server";

// why: the module imports `db` for its read-only loaders. The transaction
// functions only ever use the client they are handed; the question loader
// tests install the few delegates it reads on this object.
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: the booking sources facade (conversion, allocation, admission, the
// physical check) has its own suite; here it is the seam the check-out
// dispatch hands converted slices to.
vi.mock("./sources/booking-sources.server", () => ({
  dispatchUnits: vi.fn(),
}));

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
  id?: { in: string[] };
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
  bookedOut = [],
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
  /** Slices on other ONGOING bookings, as the booked-out read returns them. */
  bookedOut?: Array<{
    id: string;
    bookingId: string;
    assetId: string;
    quantity: number;
    assetKitId: string | null;
    checkedOutQuantity: number;
    sourceLocationId: string;
  }>;
}) {
  const assetById = new Map(assets.map((a) => [a.id, a]));
  return {
    bookingAsset: {
      findMany: vi.fn(({ where }: { where: SliceWhere }) =>
        // Without slice ids this is the "units out on other bookings" read.
        !where.id
          ? resolved(bookedOut)
          : resolved(
              slices
                .filter((s) => where.id!.in.includes(s.id))
                .filter(
                  (s) =>
                    where.checkedOutQuantity === undefined ||
                    s.checkedOutQuantity === where.checkedOutQuantity
                )
                .filter(
                  (s) => s.organizationId === where.booking.organizationId
                )
                .filter((s) => {
                  const asset = assetById.get(s.assetId);
                  return (
                    !where.asset ||
                    (asset?.type === where.asset.type &&
                      asset.organizationId === where.asset.organizationId)
                  );
                })
                .map(({ id, assetId, assetKitId }) => ({
                  id,
                  assetId,
                  assetKitId,
                }))
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
          const ids = where.id?.in ?? [];
          for (const s of slices) {
            if (
              ids.includes(s.id) &&
              s.organizationId === where.booking.organizationId
            ) {
              s.sourceLocationId = data.sourceLocationId;
            }
          }
          return resolved({ count: ids.length });
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
    // Nothing has come back on the other bookings in these scenarios.
    consumptionLog: { findMany: vi.fn(() => resolved([])) },
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
  }> = [],
  bookedOut: Parameters<typeof fakeTx>[0]["bookedOut"] = []
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
    bookedOut,
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

  it("goes by units left: units out on another booking from a location are not there", async () => {
    // All 60 of Camera Room's units are out on another booking from there.
    const { slice, tx } = scenario(
      {},
      [],
      [
        {
          id: "ba-other",
          bookingId: "b-other",
          assetId: "pool-1",
          quantity: 60,
          assetKitId: null,
          checkedOutQuantity: 60,
          sourceLocationId: "loc-camera",
        },
      ]
    );

    await recordCheckoutSourceLocations(tx as never, {
      organizationId: ORG,
      sliceIds: [slice.id],
    });

    expect(slice.sourceLocationId).toBe("loc-studio");
  });

  it("refuses Unplaced for a pool whose units are all placed, and writes nothing", async () => {
    const { slice, tx } = scenario();

    const attempt = recordCheckoutSourceLocations(tx as never, {
      organizationId: ORG,
      sliceIds: [slice.id],
      submission: sourceSubmissionFromRecord({ "ba-1": null }),
    });

    await expect(attempt).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("has no unplaced units"),
    });
    expect(tx.bookingAsset.updateMany).not.toHaveBeenCalled();
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

describe("loadPoolSourceSnapshots", () => {
  it("takes units out on a converted booking off the location and the unplaced units they left from", async () => {
    // 60 at Camera Room, 40 at Studio, 20 unplaced. A converted ONGOING
    // booking has 10 out from Camera Room and 5 out from the unplaced units.
    const tx = {
      asset: {
        findMany: vi.fn(() =>
          resolved([
            {
              id: "pool-1",
              title: "Cables",
              quantity: 120,
              unitOfMeasure: null,
            },
          ])
        ),
      },
      assetLocation: {
        findMany: vi.fn(() =>
          resolved([
            {
              assetId: "pool-1",
              locationId: "loc-camera",
              quantity: 60,
              location: { name: "Camera Room" },
            },
            {
              assetId: "pool-1",
              locationId: "loc-studio",
              quantity: 40,
              location: { name: "Studio" },
            },
          ])
        ),
      },
      custody: { findMany: vi.fn(() => resolved([])) },
      consumptionLog: { findMany: vi.fn(() => resolved([])) },
      bookingAsset: {
        // The one out-units slice read finds a converted slice only.
        findMany: vi.fn(() =>
          resolved([
            {
              id: "ba-other",
              bookingId: "booking-other",
              assetId: "pool-1",
              quantity: 15,
              assetKitId: null,
              checkedOutQuantity: 15,
              sourceLocationId: null,
              sourceAllocation: "AUTO",
              booking: { status: "ONGOING" },
            },
          ])
        ),
      },
      bookingAssetSource: {
        findMany: vi.fn(() =>
          resolved([
            {
              bookingAssetId: "ba-other",
              kind: "LOCATION",
              locationId: "loc-camera",
              outQuantity: 10,
            },
            {
              bookingAssetId: "ba-other",
              kind: "UNPLACED",
              locationId: null,
              outQuantity: 5,
            },
          ])
        ),
      },
    };

    const snapshots = await loadPoolSourceSnapshots(tx as never, {
      organizationId: ORG,
      assetIds: ["pool-1"],
    });

    const snapshot = snapshots.get("pool-1");
    expect(
      snapshot?.placements.map((p) => [p.locationId, p.onBooking, p.left])
    ).toEqual([
      ["loc-camera", 10, 50],
      ["loc-studio", 0, 40],
    ]);
    expect(snapshot?.unplacedLeft).toBe(15);
  });
});

describe("dispatchCheckoutSources", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hands pool slices to the facade with their picks, and records only what stays LEGACY the LEGACY way", async () => {
    const { tx } = scenario();
    vi.mocked(dispatchUnits).mockResolvedValue({
      dispatched: [
        {
          sliceId: "ba-converted",
          assetId: "pool-2",
          sources: [
            {
              kind: "UNPLACED",
              locationId: null,
              name: "Unplaced",
              quantity: 3,
            },
          ],
        },
      ],
      legacySliceIds: ["ba-1"],
    });
    const window = { from: new Date("2026-12-01"), to: new Date("2026-12-03") };

    const dispatched = await dispatchCheckoutSources(tx as never, {
      organizationId: ORG,
      bookingId: "booking-1",
      departures: [
        { sliceId: "ba-1", assetId: "pool-1", units: 10 },
        { sliceId: "ba-converted", assetId: "pool-2", units: 3 },
        { sliceId: "ba-camera", assetId: "camera-1", units: 1 },
        { sliceId: "ba-nothing", assetId: "pool-2", units: 0 },
      ],
      poolAssetIds: new Set(["pool-1", "pool-2"]),
      // Keyed by slice for one, by asset for the other.
      submission: sourceSubmissionFromRecord({
        "ba-1": "loc-studio",
        "pool-2": null,
      }),
      window,
      clientSupportsSources: false,
    });

    expect(dispatchUnits).toHaveBeenCalledWith(tx, {
      organizationId: ORG,
      bookingId: "booking-1",
      window,
      clientSupportsSources: false,
      picks: [
        { sliceId: "ba-1", units: 10, fromLocationId: "loc-studio" },
        { sliceId: "ba-converted", units: 3, fromLocationId: null },
      ],
    });
    // The LEGACY recorder sees the LEGACY pool slice and the INDIVIDUAL one.
    expect(tx.bookingAsset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ["ba-1", "ba-camera"] },
        }),
      })
    );
    expect(dispatched.map((d) => d.sliceId)).toEqual(["ba-converted"]);
  });

  it("never calls the facade when no pool slice leaves", async () => {
    const { tx } = scenario();

    const dispatched = await dispatchCheckoutSources(tx as never, {
      organizationId: ORG,
      bookingId: "booking-1",
      departures: [{ sliceId: "ba-camera", assetId: "camera-1", units: 1 }],
      poolAssetIds: new Set(),
      window: { from: new Date("2026-12-01"), to: new Date("2026-12-03") },
    });

    expect(dispatchUnits).not.toHaveBeenCalled();
    expect(dispatched).toEqual([]);
  });

  it("propagates a facade refusal before anything LEGACY is written", async () => {
    const { tx } = scenario();
    vi.mocked(dispatchUnits).mockRejectedValue(
      new ShelfError({
        cause: null,
        label: "Booking",
        status: 400,
        shouldBeCaptured: false,
        message: "Only 3 units are at Demo Warehouse right now.",
      })
    );

    await expect(
      dispatchCheckoutSources(tx as never, {
        organizationId: ORG,
        bookingId: "booking-1",
        departures: [{ sliceId: "ba-1", assetId: "pool-1", units: 10 }],
        poolAssetIds: new Set(["pool-1"]),
        window: { from: new Date("2026-12-01"), to: new Date("2026-12-03") },
      })
    ).rejects.toMatchObject({
      status: 400,
      message: "Only 3 units are at Demo Warehouse right now.",
    });
    expect(tx.bookingAsset.updateMany).not.toHaveBeenCalled();
  });
});

describe("getCheckoutSourceQuestions for slices with planned sources", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Installs the reads the question loader makes on the root client: one
   * slice of a pool at Camera Room and Studio, converted (`AUTO`, its rows
   * planning `rows`) unless `mode` says LEGACY.
   */
  function stageConverted(
    rows: Array<{
      kind: "LOCATION" | "UNPLACED";
      locationId: string | null;
      quantity: number;
      releasedQuantity?: number;
    }>,
    mode: "AUTO" | "LEGACY" = "AUTO"
  ) {
    Object.assign(db, {
      bookingAsset: {
        findMany: vi.fn(({ where }: { where: { bookingId?: string } }) =>
          resolved(
            where.bookingId
              ? [
                  {
                    id: "ba-1",
                    assetId: "pool-1",
                    quantity: 15,
                    sourceAllocation: mode,
                  },
                ]
              : []
          )
        ),
      },
      bookingAssetSource: {
        findMany: vi.fn(() =>
          resolved(
            rows.map((row) => ({
              bookingAssetId: "ba-1",
              outQuantity: 0,
              releasedQuantity: 0,
              ...row,
            }))
          )
        ),
      },
      asset: {
        findMany: vi.fn(() =>
          resolved([
            {
              id: "pool-1",
              title: "Cables",
              quantity: 120,
              unitOfMeasure: null,
            },
          ])
        ),
      },
      assetLocation: {
        findMany: vi.fn(() =>
          resolved([
            {
              assetId: "pool-1",
              locationId: "loc-camera",
              quantity: 60,
              location: { name: "Camera Room" },
            },
            {
              assetId: "pool-1",
              locationId: "loc-studio",
              quantity: 40,
              location: { name: "Studio" },
            },
          ])
        ),
      },
      custody: { findMany: vi.fn(() => resolved([])) },
      consumptionLog: { findMany: vi.fn(() => resolved([])) },
    });
  }

  it('defaults a split plan to "as planned"', async () => {
    stageConverted([
      { kind: "LOCATION", locationId: "loc-studio", quantity: 8 },
      { kind: "UNPLACED", locationId: null, quantity: 7 },
    ]);

    const questions = await getCheckoutSourceQuestions({
      organizationId: ORG,
      bookingId: "booking-1",
    });

    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({
      sliceId: "ba-1",
      defaultLocationId: ALLOCATION_SOURCE_FORM_VALUE,
      fromAllocation: true,
    });
  });

  it('names a split plan for the "As planned" option', async () => {
    stageConverted([
      { kind: "LOCATION", locationId: "loc-studio", quantity: 8 },
      { kind: "UNPLACED", locationId: null, quantity: 7 },
    ]);

    const [question] = await getCheckoutSourceQuestions({
      organizationId: ORG,
      bookingId: "booking-1",
    });

    expect(question.plannedSummary).toBe("Studio 8 · Unplaced 7");
  });

  it("names a planned location the pool is no longer placed at", async () => {
    stageConverted([
      { kind: "LOCATION", locationId: "loc-back", quantity: 5 },
      { kind: "LOCATION", locationId: "loc-studio", quantity: 10 },
    ]);
    const findLocations = vi.fn(() =>
      resolved([{ id: "loc-back", name: "Back Room" }])
    );
    Object.assign(db, { location: { findMany: findLocations } });

    const [question] = await getCheckoutSourceQuestions({
      organizationId: ORG,
      bookingId: "booking-1",
    });

    expect(question.plannedSummary).toBe("Back Room 5 · Studio 10");
    // Only the missing name is looked up, inside the workspace.
    expect(findLocations).toHaveBeenCalledWith({
      where: { id: { in: ["loc-back"] }, organizationId: ORG },
      select: { id: true, name: true },
    });
  });

  it("names no plan for a LEGACY slice", async () => {
    stageConverted([], "LEGACY");

    const [question] = await getCheckoutSourceQuestions({
      organizationId: ORG,
      bookingId: "booking-1",
      adoptionEnabled: true,
    });

    expect(question.plannedSummary).toBeUndefined();
  });

  it("asks an older phone nothing about a split slice", async () => {
    stageConverted([
      { kind: "LOCATION", locationId: "loc-studio", quantity: 8 },
      { kind: "UNPLACED", locationId: null, quantity: 7 },
    ]);

    const questions = await getCheckoutSourceQuestions({
      organizationId: ORG,
      bookingId: "booking-1",
      clientSupportsSources: false,
    });

    expect(questions).toEqual([]);
  });

  it("asks an older phone about a slice planned at one source, defaulting to that source, and an untouched answer still dispatches by allocation", async () => {
    // Studio is not the shelf default (Camera Room has more left), so the
    // default can only come from the plan.
    stageConverted([
      { kind: "LOCATION", locationId: "loc-studio", quantity: 15 },
    ]);

    const questions = await getCheckoutSourceQuestions({
      organizationId: ORG,
      bookingId: "booking-1",
      clientSupportsSources: false,
    });

    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({
      defaultLocationId: "loc-studio",
      fromAllocation: true,
    });

    // An older phone sends only the rows the operator changed, so an
    // untouched default arrives as no answer at all.
    const { tx } = scenario();
    // why: the facade's dispatch is covered by its own suite; this test only
    // reads the picks it is handed
    vi.mocked(dispatchUnits).mockResolvedValue({
      dispatched: [],
      legacySliceIds: [],
    });
    await dispatchCheckoutSources(tx as never, {
      organizationId: ORG,
      bookingId: "booking-1",
      departures: [{ sliceId: "ba-1", assetId: "pool-1", units: 15 }],
      poolAssetIds: new Set(["pool-1"]),
      submission: sourceSubmissionFromRecord({}),
      window: { from: new Date("2026-12-01"), to: new Date("2026-12-03") },
      clientSupportsSources: false,
    });
    expect(vi.mocked(dispatchUnits).mock.calls[0][1].picks).toEqual([
      { sliceId: "ba-1", units: 15 },
    ]);
  });

  it("defaults an older phone to Unplaced for a slice planned at Unplaced only", async () => {
    stageConverted([{ kind: "UNPLACED", locationId: null, quantity: 15 }]);

    const questions = await getCheckoutSourceQuestions({
      organizationId: ORG,
      bookingId: "booking-1",
      clientSupportsSources: false,
    });

    expect(questions.map((q) => q.defaultLocationId)).toEqual([null]);
  });

  it("defaults an older phone to the shelf for a fully returned converted slice", async () => {
    stageConverted([
      {
        kind: "LOCATION",
        locationId: "loc-studio",
        quantity: 15,
        releasedQuantity: 15,
      },
    ]);

    const questions = await getCheckoutSourceQuestions({
      organizationId: ORG,
      bookingId: "booking-1",
      clientSupportsSources: false,
    });

    // No pending source to show, so the shelf default (most units left).
    expect(questions.map((q) => q.defaultLocationId)).toEqual(["loc-camera"]);
  });

  it("defaults an older phone to the shelf for a LEGACY slice when adoption is on", async () => {
    stageConverted([], "LEGACY");

    const questions = await getCheckoutSourceQuestions({
      organizationId: ORG,
      bookingId: "booking-1",
      clientSupportsSources: false,
      adoptionEnabled: true,
    });

    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({
      defaultLocationId: "loc-camera",
      fromAllocation: false,
    });
  });

  it('defaults a slice planned at one source to "as planned" too', async () => {
    stageConverted([
      { kind: "LOCATION", locationId: "loc-camera", quantity: 15 },
    ]);

    const questions = await getCheckoutSourceQuestions({
      organizationId: ORG,
      bookingId: "booking-1",
    });

    expect(questions.map((q) => q.defaultLocationId)).toEqual([
      ALLOCATION_SOURCE_FORM_VALUE,
    ]);
  });

  it('dispatches a fully returned converted slice departing again by its plan when the "as planned" default is submitted', async () => {
    // Everything went out and came back: no pending units are left anywhere.
    stageConverted([
      {
        kind: "LOCATION",
        locationId: "loc-camera",
        quantity: 15,
        releasedQuantity: 15,
      },
    ]);
    const [question] = await getCheckoutSourceQuestions({
      organizationId: ORG,
      bookingId: "booking-1",
    });
    expect(question.defaultLocationId).toBe(ALLOCATION_SOURCE_FORM_VALUE);

    // The dialog submits its select untouched.
    const form = new FormData();
    form.set(sourceLocationFieldName("ba-1"), question.defaultLocationId ?? "");
    const { tx } = scenario();
    // why: the facade's dispatch is covered by its own suite; this test only
    // reads the picks it is handed
    vi.mocked(dispatchUnits).mockResolvedValue({
      dispatched: [],
      legacySliceIds: [],
    });

    await dispatchCheckoutSources(tx as never, {
      organizationId: ORG,
      bookingId: "booking-1",
      departures: [{ sliceId: "ba-1", assetId: "pool-1", units: 15 }],
      poolAssetIds: new Set(["pool-1"]),
      submission: parseSourceLocationsFromFormData(form),
      window: { from: new Date("2026-12-01"), to: new Date("2026-12-03") },
    });

    // No pick: the facade re-claims the released units by allocation instead
    // of moving them into a shelf default and making the slice MANUAL.
    expect(vi.mocked(dispatchUnits).mock.calls[0][1].picks).toEqual([
      { sliceId: "ba-1", units: 15 },
    ]);
  });

  it('defaults a LEGACY slice to "as planned" when adoption is on, and submitting it sends no pick', async () => {
    // The "legacy slice checks out against A held by a new booking" case: the
    // shelf default would be Camera Room (most units left), which a newer
    // booking holds. Submitting it unchanged would force the slice into it.
    stageConverted([], "LEGACY");
    const [question] = await getCheckoutSourceQuestions({
      organizationId: ORG,
      bookingId: "booking-1",
      adoptionEnabled: true,
    });
    expect(question).toMatchObject({
      defaultLocationId: ALLOCATION_SOURCE_FORM_VALUE,
      fromAllocation: false,
    });

    const form = new FormData();
    form.set(sourceLocationFieldName("ba-1"), question.defaultLocationId ?? "");
    const { tx } = scenario();
    // why: the facade's dispatch is covered by its own suite; this test only
    // reads the picks it is handed
    vi.mocked(dispatchUnits).mockResolvedValue({
      dispatched: [],
      legacySliceIds: [],
    });

    await dispatchCheckoutSources(tx as never, {
      organizationId: ORG,
      bookingId: "booking-1",
      departures: [{ sliceId: "ba-1", assetId: "pool-1", units: 15 }],
      poolAssetIds: new Set(["pool-1"]),
      submission: parseSourceLocationsFromFormData(form),
      window: { from: new Date("2026-12-01"), to: new Date("2026-12-03") },
      adoptionEnabled: true,
    });

    // By allocation: the facade converts the group and sends it from the
    // source that fits (Back Room, or a split), as its own suite proves.
    expect(vi.mocked(dispatchUnits).mock.calls[0][1].picks).toEqual([
      { sliceId: "ba-1", units: 15 },
    ]);
  });

  it("keeps the shelf default for a LEGACY slice when adoption is off", async () => {
    stageConverted([], "LEGACY");

    const questions = await getCheckoutSourceQuestions({
      organizationId: ORG,
      bookingId: "booking-1",
      adoptionEnabled: false,
    });

    // Camera Room has the most units left.
    expect(questions.map((q) => q.defaultLocationId)).toEqual(["loc-camera"]);
  });
});
