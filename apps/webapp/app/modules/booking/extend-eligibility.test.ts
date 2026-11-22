/**
 * Tests for the booking extension state rules shared by `extendBooking` and
 * the mobile `canExtend` flag.
 *
 * @see {@link file://./extend-eligibility.ts}
 */
import { AssetStatus, AssetType, BookingStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  getAssetsStillOutForExtend,
  getKitMembershipIdsStillOut,
  getQuantityAssetIdsStillOut,
  hasItemsStillOutToExtend,
  isExtendableStatus,
} from "./extend-eligibility";

const OUT_AT = new Date("2026-01-01T10:00:00.000Z");
const BACK_AT = new Date("2026-01-01T12:00:00.000Z");

describe("isExtendableStatus", () => {
  it("allows only a started booking", () => {
    expect(isExtendableStatus(BookingStatus.ONGOING)).toBe(true);
    expect(isExtendableStatus(BookingStatus.OVERDUE)).toBe(true);
    for (const status of [
      BookingStatus.DRAFT,
      BookingStatus.RESERVED,
      BookingStatus.COMPLETE,
      BookingStatus.ARCHIVED,
      BookingStatus.CANCELLED,
    ]) {
      expect(isExtendableStatus(status)).toBe(false);
    }
  });
});

describe("getAssetsStillOutForExtend", () => {
  it("keeps checked-out and in-custody assets that no partial check-in returned", () => {
    const assets = [
      { id: "out", status: AssetStatus.CHECKED_OUT },
      { id: "custody", status: AssetStatus.IN_CUSTODY },
      { id: "returned", status: AssetStatus.CHECKED_OUT },
      { id: "available", status: AssetStatus.AVAILABLE },
    ];

    expect(
      getAssetsStillOutForExtend(assets, ["returned"]).map((a) => a.id)
    ).toEqual(["out", "custody"]);
  });
});

describe("getKitMembershipIdsStillOut", () => {
  it("lists kit slices that went out and are not back", () => {
    expect(
      getKitMembershipIdsStillOut([
        { assetKitId: "ak-out", checkedOutAt: OUT_AT, checkedInAt: null },
        { assetKitId: "ak-back", checkedOutAt: OUT_AT, checkedInAt: BACK_AT },
        { assetKitId: "ak-never", checkedOutAt: null, checkedInAt: null },
        { assetKitId: null, checkedOutAt: OUT_AT, checkedInAt: null },
      ])
    ).toEqual(["ak-out"]);
  });
});

describe("getQuantityAssetIdsStillOut", () => {
  const pool = (id: string) => ({
    id,
    status: AssetStatus.AVAILABLE,
    type: AssetType.QUANTITY_TRACKED,
  });

  it("reads standalone pool slices from their markers, whatever the shared status", () => {
    expect(
      getQuantityAssetIdsStillOut({
        assets: [
          pool("out"),
          pool("back"),
          pool("never"),
          pool("kit"),
          { id: "cam", status: AssetStatus.CHECKED_OUT },
        ],
        slices: [
          {
            assetId: "out",
            assetKitId: null,
            checkedOutAt: OUT_AT,
            checkedInAt: null,
          },
          {
            assetId: "back",
            assetKitId: null,
            checkedOutAt: OUT_AT,
            checkedInAt: BACK_AT,
          },
          {
            assetId: "never",
            assetKitId: null,
            checkedOutAt: null,
            checkedInAt: null,
          },
          {
            assetId: "kit",
            assetKitId: "ak",
            checkedOutAt: OUT_AT,
            checkedInAt: null,
          },
          {
            assetId: "cam",
            assetKitId: null,
            checkedOutAt: OUT_AT,
            checkedInAt: null,
          },
        ],
      })
    ).toEqual(["out"]);
  });
});

describe("hasItemsStillOutToExtend", () => {
  it("is true while only units of a pool are out", () => {
    expect(
      hasItemsStillOutToExtend({
        assets: [
          {
            id: "cable",
            status: AssetStatus.AVAILABLE,
            type: AssetType.QUANTITY_TRACKED,
          },
        ],
        checkedInAssetIds: [],
        slices: [
          {
            assetId: "cable",
            assetKitId: null,
            checkedOutAt: OUT_AT,
            checkedInAt: null,
          },
        ],
      })
    ).toBe(true);
  });

  it("is true while an asset is out", () => {
    expect(
      hasItemsStillOutToExtend({
        assets: [{ id: "a", status: AssetStatus.CHECKED_OUT }],
        checkedInAssetIds: [],
        slices: [],
      })
    ).toBe(true);
  });

  it("is true while only a kit slice is out", () => {
    // A quantity-tracked kit member stays AVAILABLE until every unit has
    // left, so the slice marker alone keeps the booking extendable.
    expect(
      hasItemsStillOutToExtend({
        assets: [{ id: "a", status: AssetStatus.AVAILABLE }],
        checkedInAssetIds: [],
        slices: [{ assetKitId: "ak", checkedOutAt: OUT_AT, checkedInAt: null }],
      })
    ).toBe(true);
  });

  it("is false once everything is back", () => {
    expect(
      hasItemsStillOutToExtend({
        assets: [{ id: "a", status: AssetStatus.CHECKED_OUT }],
        checkedInAssetIds: ["a"],
        slices: [
          { assetKitId: "ak", checkedOutAt: OUT_AT, checkedInAt: BACK_AT },
        ],
      })
    ).toBe(false);
  });
});
