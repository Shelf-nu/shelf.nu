/**
 * Every blocker the partial check-out drawer can raise, one case each.
 *
 * A missing blocker is not a missing warning: a scanned row the drawer cannot
 * act on is submitted anyway and the operator is told it went out. The drawer
 * itself is impractical to mount, so the list is pinned here.
 *
 * The contract: for each blocker id, a row in that state raises it, and a
 * healthy row does not. `EXPECTED_IDS` pins the set itself, so adding a
 * blocker without a case here fails rather than passing silently.
 *
 * @see {@link file://./partial-checkout-blockers.tsx}
 */

import { describe, expect, it, vi } from "vitest";

import type { ScanListItems } from "~/atoms/qr-scanner";
import {
  ALLOCATION_SOURCE_FORM_VALUE,
  UNPLACED_SOURCE_FORM_VALUE,
} from "~/modules/booking/checkout-source-location";
import type { AssetFromQr } from "~/routes/api+/get-scanned-item.$qrId";

import {
  assetIdsWithPickedSource,
  buildPartialCheckoutBlockers,
  questionsAtSubmittedQuantities,
  withoutSourcePick,
  type PartialCheckoutBlockers,
  type PickedSourceQuestion,
} from "./partial-checkout-blockers";

/** Every blocker the partial check-out drawer declares, in order. */
const EXPECTED_IDS = [
  "assets-not-in-booking",
  "assets-already-checked-out",
  "assets-in-custody",
  "short-source",
  "kits-already-checked-out",
  "kit-in-custody",
  "kits-booked-elsewhere",
  "kit-assets-booked-elsewhere",
  "redundant-kit-assets",
  "kits-not-in-booking",
  "assets-archived",
  "invalid-codes",
];

/** A scanned asset row, cut down to the fields the blockers read. */
function assetItem(asset: Partial<AssetFromQr> & { id: string }) {
  return {
    type: "asset" as const,
    data: {
      type: "INDIVIDUAL",
      status: "AVAILABLE",
      assetKits: [],
      ...asset,
    } as unknown as AssetFromQr,
  };
}

/** A kit member as the scanned kit payload carries it. */
type Member = { id: string; status?: string; type?: string };

/** A scanned kit row. `custody` stands in for the kit's `KitCustody` row. */
function kitItem(
  id: string,
  {
    members = [],
    custody = null,
    status = "AVAILABLE",
  }: {
    members?: Member[];
    custody?: { custodian: { name: string } } | null;
    status?: string;
  } = {}
) {
  return {
    type: "kit" as const,
    data: {
      id,
      status,
      custody,
      assetKits: members.map((m) => ({
        asset: { status: "AVAILABLE", type: "INDIVIDUAL", ...m },
      })),
    } as never,
  };
}

const HELD = { custodian: { name: "Sam" } };

/** Builds with spies so resolve wiring can be asserted too. */
function build(
  items: ScanListItems,
  {
    bookingAssetIds = ["a1", "a2", "m1", "m2"],
    remainingByAssetId = {},
    alreadyCheckedOut = [],
    kitsBookedElsewhere = [],
    assetsInKitsBookedElsewhere = [],
    shortSourceAssetIds = [],
    pickedSourceAssetIds = [],
  }: {
    bookingAssetIds?: string[];
    remainingByAssetId?: Record<string, number>;
    alreadyCheckedOut?: string[];
    kitsBookedElsewhere?: string[];
    assetsInKitsBookedElsewhere?: string[];
    shortSourceAssetIds?: string[];
    pickedSourceAssetIds?: string[];
  } = {}
): PartialCheckoutBlockers & {
  removeAssetsFromList: ReturnType<typeof vi.fn>;
  removeItemsFromList: ReturnType<typeof vi.fn>;
} {
  // why: the drawer passes jotai atom setters; a spy records what is dropped
  const removeAssetsFromList = vi.fn();
  const removeItemsFromList = vi.fn();
  return {
    ...buildPartialCheckoutBlockers({
      items,
      bookingAssetIds: new Set(bookingAssetIds),
      remainingByAssetId,
      alreadyCheckedOut: new Set(alreadyCheckedOut),
      kitsBookedElsewhere: new Set(kitsBookedElsewhere),
      assetsInKitsBookedElsewhere: new Set(assetsInKitsBookedElsewhere),
      shortSourceAssetIds: new Set(shortSourceAssetIds),
      pickedSourceAssetIds: new Set(pickedSourceAssetIds),
      removeAssetsFromList,
      removeItemsFromList,
    }),
    removeAssetsFromList,
    removeItemsFromList,
  };
}

/** Ids of the blockers currently firing. */
function activeIds(built: PartialCheckoutBlockers): string[] {
  return built.blockerConfigs.filter((b) => b.condition).map((b) => b.id ?? "");
}

/** Every id a remove spy was asked to drop, across all its calls. */
function removedBy(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.flatMap(([ids]) => ids as string[]);
}

describe("buildPartialCheckoutBlockers", () => {
  it("declares exactly the blockers this suite covers", () => {
    const built = build({});
    expect(built.blockerConfigs.map((b) => b.id)).toEqual(EXPECTED_IDS);
  });

  it("raises nothing for a healthy scan", () => {
    const built = build({
      qr1: assetItem({ id: "a1" }),
      qr2: kitItem("k1", { members: [{ id: "m1" }] }),
    });
    expect(activeIds(built)).toEqual([]);
  });

  it("assets-not-in-booking: an asset this booking does not hold", () => {
    const built = build({ qr1: assetItem({ id: "other" }) });
    expect(activeIds(built)).toEqual(["assets-not-in-booking"]);
    built.blockerConfigs
      .find((b) => b.id === "assets-not-in-booking")
      ?.onResolve();
    expect(built.removeAssetsFromList).toHaveBeenCalledWith(["other"]);
  });

  it("assets-already-checked-out: an individual asset recorded as out", () => {
    const built = build(
      { qr1: assetItem({ id: "a1" }) },
      { alreadyCheckedOut: ["a1"] }
    );
    expect(activeIds(built)).toEqual(["assets-already-checked-out"]);
  });

  it("assets-already-checked-out: a quantity asset with units left stays scannable", () => {
    const built = build(
      { qr1: assetItem({ id: "a1", type: "QUANTITY_TRACKED" } as never) },
      { remainingByAssetId: { a1: 5 } }
    );
    expect(activeIds(built)).toEqual([]);
  });

  it("assets-in-custody: a booked asset someone holds", () => {
    const built = build({ qr1: assetItem({ id: "a1", status: "IN_CUSTODY" }) });
    expect(activeIds(built)).toEqual(["assets-in-custody"]);
  });

  it("assets-in-custody: a quantity-tracked pool with some units held does not block", () => {
    // 14 units, 6 held by two people: the pool reads IN_CUSTODY, and the one
    // unit this booking reserved is still free to go out.
    const built = build(
      {
        qr1: assetItem({
          id: "a1",
          type: "QUANTITY_TRACKED",
          status: "IN_CUSTODY",
        } as never),
      },
      { remainingByAssetId: { a1: 1 } }
    );
    expect(activeIds(built)).toEqual([]);
  });

  it("short-source: a pool whose slice is short at its source", () => {
    const built = build(
      { qrPool: assetItem({ id: "a1", type: "QUANTITY_TRACKED" } as never) },
      { remainingByAssetId: { a1: 5 }, shortSourceAssetIds: ["a1"] }
    );
    expect(activeIds(built)).toEqual(["short-source"]);
    built.blockerConfigs.find((b) => b.id === "short-source")?.onResolve();
    expect(built.removeItemsFromList).toHaveBeenCalledWith(["qrPool"]);
  });

  it("short-source: a pool with room at its sources does not block", () => {
    const built = build(
      { qrPool: assetItem({ id: "a1", type: "QUANTITY_TRACKED" } as never) },
      { remainingByAssetId: { a1: 5 }, shortSourceAssetIds: ["a2"] }
    );
    expect(activeIds(built)).toEqual([]);
  });

  it("short-source: a short pool the operator sends out from a picked source with room does not block", () => {
    const built = build(
      { qrPool: assetItem({ id: "a1", type: "QUANTITY_TRACKED" } as never) },
      {
        remainingByAssetId: { a1: 5 },
        shortSourceAssetIds: ["a1"],
        pickedSourceAssetIds: ["a1"],
      }
    );
    expect(activeIds(built)).toEqual([]);
  });

  it("short-source: a pick for another pool leaves a short pool blocked", () => {
    const built = build(
      { qrPool: assetItem({ id: "a1", type: "QUANTITY_TRACKED" } as never) },
      {
        remainingByAssetId: { a1: 5 },
        shortSourceAssetIds: ["a1"],
        pickedSourceAssetIds: ["a2"],
      }
    );
    expect(activeIds(built)).toEqual(["short-source"]);
  });

  it("short-source: a pool with nothing left to go out is reported as already out only", () => {
    const built = build(
      { qrPool: assetItem({ id: "a1", type: "QUANTITY_TRACKED" } as never) },
      { remainingByAssetId: { a1: 0 }, shortSourceAssetIds: ["a1"] }
    );
    expect(activeIds(built)).toEqual(["assets-already-checked-out"]);
  });

  it("kits-already-checked-out: every booked member is already out", () => {
    const built = build(
      { qr1: kitItem("k1", { members: [{ id: "m1" }] }) },
      { alreadyCheckedOut: ["m1"] }
    );
    expect(activeIds(built)).toEqual(["kits-already-checked-out"]);
  });

  it("kit-in-custody: a kit with a custodian", () => {
    const built = build({
      qrKit: kitItem("k1", { members: [{ id: "m1" }], custody: HELD }),
    });
    expect(activeIds(built)).toEqual(["kit-in-custody"]);
    built.blockerConfigs.find((b) => b.id === "kit-in-custody")?.onResolve();
    // Kits are dropped by the CODE that scanned them.
    expect(built.removeItemsFromList).toHaveBeenCalledWith(["qrKit"]);
  });

  it("kit-in-custody: a kit of only quantity-tracked members still blocks", () => {
    // A quantity member's status says nothing about the kit: the kit is one
    // unit, and its custody row is what makes it unavailable.
    const built = build(
      {
        qrKit: kitItem("k1", {
          members: [
            { id: "m1", type: "QUANTITY_TRACKED" },
            { id: "m2", type: "QUANTITY_TRACKED" },
          ],
          custody: HELD,
        }),
      },
      { remainingByAssetId: { m1: 10, m2: 4 } }
    );
    expect(activeIds(built)).toEqual(["kit-in-custody"]);
  });

  it("kit-in-custody: a kit with no custodian does not block", () => {
    const built = build({
      qrKit: kitItem("k1", {
        members: [{ id: "m1", type: "QUANTITY_TRACKED" }],
      }),
    });
    expect(activeIds(built)).not.toContain("kit-in-custody");
  });

  it("kits-booked-elsewhere: a kit another booking holds, e.g. still out on an overdue one", () => {
    const built = build(
      {
        qrKit: kitItem("k1", {
          members: [{ id: "m1", type: "QUANTITY_TRACKED" }],
        }),
      },
      { kitsBookedElsewhere: ["k1"], assetsInKitsBookedElsewhere: ["m1"] }
    );
    expect(activeIds(built)).toEqual(["kits-booked-elsewhere"]);
    built.blockerConfigs
      .find((b) => b.id === "kits-booked-elsewhere")
      ?.onResolve();
    expect(built.removeItemsFromList).toHaveBeenCalledWith(["qrKit"]);
  });

  it("kits-booked-elsewhere: a kit no other booking holds does not block", () => {
    const built = build(
      { qrKit: kitItem("k1", { members: [{ id: "m1" }] }) },
      { kitsBookedElsewhere: ["k2"] }
    );
    expect(activeIds(built)).toEqual([]);
  });

  it("kit-assets-booked-elsewhere: a member scanned on its own, from a kit another booking holds", () => {
    // The submit sends every slice of a scanned asset, kit slice included, so
    // the server refuses it as it would the kit.
    const built = build(
      { qrAsset: assetItem({ id: "m1", type: "QUANTITY_TRACKED" } as never) },
      {
        remainingByAssetId: { m1: 2 },
        kitsBookedElsewhere: ["k1"],
        assetsInKitsBookedElsewhere: ["m1"],
      }
    );
    expect(activeIds(built)).toEqual(["kit-assets-booked-elsewhere"]);
    built.blockerConfigs
      .find((b) => b.id === "kit-assets-booked-elsewhere")
      ?.onResolve();
    expect(built.removeItemsFromList).toHaveBeenCalledWith(["qrAsset"]);
  });

  it("kit-assets-booked-elsewhere: a member scanned with its held kit is reported once, on the kit", () => {
    const built = build(
      {
        qrAsset: assetItem({ id: "m1", assetKits: [{ kitId: "k1" }] as never }),
        qrKit: kitItem("k1", { members: [{ id: "m1" }] }),
      },
      { kitsBookedElsewhere: ["k1"], assetsInKitsBookedElsewhere: ["m1"] }
    );
    expect(activeIds(built)).toEqual([
      "kits-booked-elsewhere",
      "redundant-kit-assets",
    ]);
  });

  it("redundant-kit-assets: a member scanned alongside its kit", () => {
    const built = build({
      qrAsset: assetItem({ id: "m1", assetKits: [{ kitId: "k1" }] as never }),
      qrKit: kitItem("k1", { members: [{ id: "m1" }] }),
    });
    expect(activeIds(built)).toEqual(["redundant-kit-assets"]);
    built.blockerConfigs
      .find((b) => b.id === "redundant-kit-assets")
      ?.onResolve();
    expect(built.removeItemsFromList).toHaveBeenCalledWith(["qrAsset"]);
  });

  it("kits-not-in-booking: a kit none of whose members are booked", () => {
    const built = build({
      qrKit: kitItem("k1", { members: [{ id: "elsewhere" }] }),
    });
    expect(activeIds(built)).toEqual(["kits-not-in-booking"]);
  });

  it("assets-archived: an archived booked asset, resolved by dropping it", () => {
    const built = build({
      qr1: assetItem({ id: "a1", archivedAt: new Date() }),
      qr2: assetItem({ id: "a2" }),
    });
    expect(activeIds(built)).toEqual(["assets-archived"]);
    built.blockerConfigs.find((b) => b.id === "assets-archived")?.onResolve?.();
    expect(removedBy(built.removeAssetsFromList)).toEqual(["a1"]);
  });

  it("assets-archived: an active asset does not block", () => {
    const built = build({ qr1: assetItem({ id: "a1", archivedAt: null }) });
    expect(activeIds(built)).not.toContain("assets-archived");
  });

  it("invalid-codes: a code that resolved to nothing", () => {
    const built = build({ qr1: { error: "No such code" } });
    expect(activeIds(built)).toEqual(["invalid-codes"]);
  });

  it("resolve-all drops every blocked row, assets by id and kits by code", () => {
    const built = build({
      qr1: assetItem({ id: "other" }),
      qr2: assetItem({ id: "a1", status: "IN_CUSTODY" }),
      qrKit: kitItem("k1", { members: [{ id: "m1" }], custody: HELD }),
      qrBad: { error: "No such code" },
    });

    // What "Resolve all" runs: every shown blocker's own fix.
    built.blockerConfigs
      .filter((b) => b.condition)
      .forEach((b) => b.onResolve());

    expect(removedBy(built.removeAssetsFromList)).toEqual(["other"]);
    expect(removedBy(built.removeItemsFromList)).toEqual(
      expect.arrayContaining(["qr2", "qrKit", "qrBad"])
    );
  });
});

describe("assetIdsWithPickedSource", () => {
  /** Pens: 5 units going out, Warehouse has 8 left, Shop 2, 6 unplaced. */
  const question: PickedSourceQuestion = {
    sliceId: "ba-pens",
    assetId: "pens",
    quantity: 5,
    placements: [
      {
        locationId: "loc-warehouse",
        name: "Warehouse",
        placed: 8,
        inCustody: 0,
        onBooking: 0,
        left: 8,
      },
      {
        locationId: "loc-shop",
        name: "Shop",
        placed: 4,
        inCustody: 2,
        onBooking: 0,
        left: 2,
      },
    ],
    unplaced: 6,
  };

  it("counts a picked location with room for the slice's units", () => {
    expect(
      assetIdsWithPickedSource([question], { "ba-pens": "loc-warehouse" })
    ).toEqual(new Set(["pens"]));
  });

  it("counts Unplaced when the unplaced units cover the slice", () => {
    expect(
      assetIdsWithPickedSource([question], {
        "ba-pens": UNPLACED_SOURCE_FORM_VALUE,
      })
    ).toEqual(new Set(["pens"]));
  });

  it("skips a picked location without room for the slice's units", () => {
    expect(
      assetIdsWithPickedSource([question], { "ba-pens": "loc-shop" })
    ).toEqual(new Set());
  });

  it("skips As planned, which is the short plan itself", () => {
    expect(
      assetIdsWithPickedSource([question], {
        "ba-pens": ALLOCATION_SOURCE_FORM_VALUE,
      })
    ).toEqual(new Set());
  });

  it("skips a question the operator has not answered", () => {
    expect(assetIdsWithPickedSource([question], {})).toEqual(new Set());
  });

  it("forgets the pick of a row that left the list", () => {
    const picks = withoutSourcePick(
      { "ba-pens": "loc-warehouse", "ba-tape": "loc-shop" },
      "ba-pens"
    );
    expect(picks).toEqual({ "ba-tape": "loc-shop" });
    expect(assetIdsWithPickedSource([question], picks)).toEqual(new Set());
  });
});

describe("short-source at the submitted quantity", () => {
  /** Pens: a 5-unit slice, the picked Shelf has room for 3. */
  const roomForThree: PickedSourceQuestion = {
    sliceId: "ba-pens",
    assetId: "a1",
    quantity: 5,
    placements: [
      {
        locationId: "loc-shelf",
        name: "Shelf",
        placed: 3,
        inCustody: 0,
        onBooking: 0,
        left: 3,
      },
    ],
    unplaced: 0,
  };
  const pick = { "ba-pens": "loc-shelf" };

  /** The short-source state of a scanned short pool for a submitted count. */
  function blockersFor(submitted: number): string[] {
    const picked = assetIdsWithPickedSource(
      questionsAtSubmittedQuantities(
        [roomForThree],
        [{ bookingAssetId: "ba-pens", quantity: submitted }]
      ),
      pick
    );
    return activeIds(
      build(
        { qrPool: assetItem({ id: "a1", type: "QUANTITY_TRACKED" } as never) },
        {
          remainingByAssetId: { a1: 5 },
          shortSourceAssetIds: ["a1"],
          pickedSourceAssetIds: [...picked],
        }
      )
    );
  }

  it("room 3, 2 submitted: the pick covers what leaves, no blocker", () => {
    expect(blockersFor(2)).toEqual([]);
  });

  it("room 3, 4 submitted: the pick falls short, short-source blocks", () => {
    expect(blockersFor(4)).toEqual(["short-source"]);
  });

  it("a slice not in the payload is judged at its full quantity", () => {
    expect(
      questionsAtSubmittedQuantities([roomForThree], [])[0]?.quantity
    ).toBe(5);
  });
});
