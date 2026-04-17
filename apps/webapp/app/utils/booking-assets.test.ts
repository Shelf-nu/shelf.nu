import { AssetStatus, BookingStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import type { PartialCheckinDetailsType } from "~/modules/booking/service.server";
import {
  getBookingContextAssetStatus,
  type AssetWithStatus,
} from "~/utils/booking-assets";

/**
 * Minimal stub satisfying `PartialCheckinDetailsType`'s per-asset shape. The
 * concrete values don't influence `getBookingContextAssetStatus`'s branching
 * (only presence of the key does), so we keep this cheap and reuse it.
 */
const partialCheckinStub = {
  checkinDate: new Date("2026-04-01T10:00:00Z"),
  checkedInBy: {
    id: "user-1",
    firstName: "Test",
    lastName: "User",
    profilePicture: null,
  },
};

describe("getBookingContextAssetStatus", () => {
  it("returns PARTIALLY_CHECKED_IN for INDIVIDUAL asset with partial checkin on ONGOING booking", () => {
    expect.assertions(1);
    const asset: AssetWithStatus = {
      id: "asset-1",
      status: AssetStatus.CHECKED_OUT,
      type: "INDIVIDUAL",
    };
    const partialCheckinDetails: PartialCheckinDetailsType = {
      [asset.id]: partialCheckinStub,
    };

    expect(
      getBookingContextAssetStatus(
        asset,
        partialCheckinDetails,
        BookingStatus.ONGOING
      )
    ).toBe("PARTIALLY_CHECKED_IN");
  });

  it("returns raw asset.status for INDIVIDUAL asset without partial checkin on ONGOING booking", () => {
    expect.assertions(1);
    const asset: AssetWithStatus = {
      id: "asset-2",
      status: AssetStatus.CHECKED_OUT,
      type: "INDIVIDUAL",
    };

    expect(getBookingContextAssetStatus(asset, {}, BookingStatus.ONGOING)).toBe(
      AssetStatus.CHECKED_OUT
    );
  });

  it("returns raw asset.status for INDIVIDUAL asset on COMPLETE booking even with partial checkin", () => {
    expect.assertions(1);
    const asset: AssetWithStatus = {
      id: "asset-3",
      status: AssetStatus.CHECKED_OUT,
      type: "INDIVIDUAL",
    };
    const partialCheckinDetails: PartialCheckinDetailsType = {
      [asset.id]: partialCheckinStub,
    };

    expect(
      getBookingContextAssetStatus(
        asset,
        partialCheckinDetails,
        BookingStatus.COMPLETE
      )
    ).toBe(AssetStatus.CHECKED_OUT);
  });

  it("overrides QUANTITY_TRACKED asset to AVAILABLE on DRAFT booking despite CHECKED_OUT global status", () => {
    expect.assertions(1);
    const asset: AssetWithStatus = {
      id: "asset-4",
      status: AssetStatus.CHECKED_OUT,
      type: "QUANTITY_TRACKED",
    };

    expect(getBookingContextAssetStatus(asset, {}, BookingStatus.DRAFT)).toBe(
      AssetStatus.AVAILABLE
    );
  });

  it("does NOT override QUANTITY_TRACKED asset on ONGOING booking — returns raw CHECKED_OUT", () => {
    expect.assertions(1);
    const asset: AssetWithStatus = {
      id: "asset-5",
      status: AssetStatus.CHECKED_OUT,
      type: "QUANTITY_TRACKED",
    };

    expect(getBookingContextAssetStatus(asset, {}, BookingStatus.ONGOING)).toBe(
      AssetStatus.CHECKED_OUT
    );
  });
});
