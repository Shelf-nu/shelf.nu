/**
 * Every blocker the add-assets-to-booking drawer can raise, one case each.
 *
 * The contract these pin: for each blocker id, a row in that state raises it,
 * and a healthy row does not. `EXPECTED_IDS` pins the set itself, so adding a
 * blocker without a case here fails rather than passing silently.
 *
 * @see {@link file://./booking-scan-blockers.tsx}
 */

import type { BookingStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { ScanListItems } from "~/atoms/qr-scanner";
import type { AssetFromQr } from "~/routes/api+/get-scanned-item.$qrId";

import { buildAddToBookingBlockers } from "./booking-scan-blockers";
import type { ScanBlockers } from "./scan-blocker-helpers";

/** Every blocker the drawer declares, in order. */
const EXPECTED_IDS = [
  "assets-checked-out",
  "qty-no-units",
  "kits-checked-out",
  "assets-unavailable",
  "assets-already-added",
  "assets-part-of-kit",
  "kits-with-unavailable-assets",
  "assets-archived",
  "kits-only-archived",
  "invalid-codes",
];

/** A scanned asset row, cut down to the fields the blockers read. */
function assetItem(asset: Partial<AssetFromQr> & { id: string }) {
  return {
    type: "asset" as const,
    data: {
      type: "INDIVIDUAL",
      status: "AVAILABLE",
      availableToBook: true,
      archivedAt: null,
      assetKits: [],
      ...asset,
    } as unknown as AssetFromQr,
  };
}

/** A scanned kit row. Members are active and bookable unless overridden. */
function kitItem(
  id: string,
  {
    status = "AVAILABLE",
    members = [{}],
  }: {
    status?: string;
    members?: { availableToBook?: boolean; archivedAt?: string | null }[];
  } = {}
) {
  return {
    type: "kit" as const,
    data: {
      id,
      status,
      assetKits: members.map((m, i) => ({
        id: `ak-${id}-${i}`,
        asset: {
          id: `${id}-m${i}`,
          status: "AVAILABLE",
          availableToBook: m.availableToBook ?? true,
          archivedAt: m.archivedAt ?? null,
        },
      })),
    } as never,
  };
}

/** Builds with spies so resolve wiring can be asserted too. */
function build(
  items: ScanListItems,
  {
    status = "RESERVED",
    bookedAssetIds = [],
    claimedAssetIds = [],
  }: {
    status?: string;
    bookedAssetIds?: string[];
    claimedAssetIds?: string[];
  } = {}
) {
  const removeAssetsFromList = vi.fn();
  const removeItemsFromList = vi.fn();
  return {
    ...buildAddToBookingBlockers({
      items,
      booking: {
        status: status as BookingStatus,
        bookingAssets: bookedAssetIds.map((assetId) => ({ assetId })),
      },
      claimedAssetIds: new Set(claimedAssetIds),
      removeAssetsFromList,
      removeItemsFromList,
    }),
    removeAssetsFromList,
    removeItemsFromList,
  };
}

/** Ids of the blockers currently firing. */
function activeIds(built: ScanBlockers): string[] {
  return built.blockerConfigs.filter((b) => b.condition).map((b) => b.id ?? "");
}

/** Every id a remove spy was asked to drop, across all its calls. */
function removedBy(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.flatMap(([ids]) => ids as string[]);
}

describe("buildAddToBookingBlockers", () => {
  it("declares exactly the blockers this suite covers", () => {
    expect(build({}).blockerConfigs.map((b) => b.id)).toEqual(EXPECTED_IDS);
  });

  it("raises nothing for a healthy scan", () => {
    const built = build({
      qr1: assetItem({ id: "a1" }),
      qr2: kitItem("k1", { members: [{}, {}] }),
    });
    expect(activeIds(built)).toEqual([]);
  });

  it("assets-archived: an archived asset, which still reads AVAILABLE", () => {
    const built = build({
      qr1: assetItem({ id: "a1", archivedAt: new Date() }),
      qr2: assetItem({ id: "a2" }),
    });
    expect(activeIds(built)).toEqual(["assets-archived"]);
    built.blockerConfigs.find((b) => b.id === "assets-archived")?.onResolve();
    expect(removedBy(built.removeAssetsFromList)).toEqual(["a1"]);
  });

  it("kits-only-archived: a kit whose every member is archived", () => {
    const built = build({
      qr1: kitItem("k1", {
        members: [
          { archivedAt: "2026-10-01T00:00:00Z" },
          { archivedAt: "2026-10-02T00:00:00Z" },
        ],
      }),
    });
    expect(activeIds(built)).toEqual(["kits-only-archived"]);
    built.blockerConfigs
      .find((b) => b.id === "kits-only-archived")
      ?.onResolve();
    expect(removedBy(built.removeItemsFromList)).toEqual(["qr1"]);
  });

  it("kits-only-archived: a kit with one active member is booked with it", () => {
    const built = build({
      qr1: kitItem("k1", {
        members: [{ archivedAt: "2026-10-01T00:00:00Z" }, {}],
      }),
    });
    expect(activeIds(built)).toEqual([]);
  });

  it("assets-checked-out: only while the booking itself is out", () => {
    const items = { qr1: assetItem({ id: "a1", status: "CHECKED_OUT" }) };
    expect(activeIds(build(items, { status: "ONGOING" }))).toEqual([
      "assets-checked-out",
    ]);
    expect(activeIds(build(items, { status: "RESERVED" }))).toEqual([]);
  });

  it("assets-checked-out: never judges a quantity row by its status", () => {
    const built = build(
      {
        qr1: assetItem({
          id: "a1",
          type: "QUANTITY_TRACKED",
          status: "CHECKED_OUT",
          quantity: 10,
        } as Partial<AssetFromQr> & { id: string }),
      },
      { status: "ONGOING" }
    );
    expect(activeIds(built)).toEqual([]);
  });

  it("qty-no-units: a quantity row with nothing left for this booking", () => {
    const qtyRow = assetItem({
      id: "a1",
      type: "QUANTITY_TRACKED",
      quantity: 10,
      pickerMeta: { maxAllowed: 0, assetQuantity: 10, unitOfMeasure: null },
    } as Partial<AssetFromQr> & { id: string });
    expect(activeIds(build({ qr1: qtyRow }))).toEqual(["qty-no-units"]);
    // Already on the booking: the scan is a no-op, flagged as a duplicate.
    expect(
      activeIds(build({ qr1: qtyRow }, { bookedAssetIds: ["a1"] }))
    ).not.toContain("qty-no-units");
  });

  it("kits-checked-out: only while the booking itself is out", () => {
    const items = { qr1: kitItem("k1", { status: "CHECKED_OUT" }) };
    expect(activeIds(build(items, { status: "OVERDUE" }))).toEqual([
      "kits-checked-out",
    ]);
    expect(activeIds(build(items, { status: "DRAFT" }))).toEqual([]);
  });

  it("assets-unavailable: an asset marked unavailable to book", () => {
    const built = build({
      qr1: assetItem({ id: "a1", availableToBook: false }),
    });
    expect(activeIds(built)).toEqual(["assets-unavailable"]);
  });

  it("assets-already-added: unless the matcher claims the scan", () => {
    const items = { qr1: assetItem({ id: "a1" }) };
    expect(activeIds(build(items, { bookedAssetIds: ["a1"] }))).toEqual([
      "assets-already-added",
    ]);
    expect(
      activeIds(
        build(items, { bookedAssetIds: ["a1"], claimedAssetIds: ["a1"] })
      )
    ).toEqual([]);
  });

  it("assets-part-of-kit: an individual member of a kit", () => {
    const built = build({
      qr1: assetItem({ id: "a1", assetKits: [{ kitId: "k1" }] as never }),
    });
    expect(activeIds(built)).toEqual(["assets-part-of-kit"]);
  });

  it("kits-with-unavailable-assets: a kit holding an unbookable member", () => {
    const built = build({
      qr1: kitItem("k1", { members: [{}, { availableToBook: false }] }),
    });
    expect(activeIds(built)).toEqual(["kits-with-unavailable-assets"]);
    built.blockerConfigs
      .find((b) => b.id === "kits-with-unavailable-assets")
      ?.onResolve();
    expect(removedBy(built.removeItemsFromList)).toEqual(["qr1"]);
  });

  it("invalid-codes: a code that resolved to nothing", () => {
    const built = build({ qr1: { error: "No such code" } });
    expect(activeIds(built)).toEqual(["invalid-codes"]);
  });
});
