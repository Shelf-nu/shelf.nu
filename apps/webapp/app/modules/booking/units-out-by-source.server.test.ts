import { describe, expect, it, vi } from "vitest";

import { unitsStillOutBySlice } from "./units-out-by-source.server";

// @vitest-environment node

// why: the module's loader reads through `db`; the pure attribution under
// test never touches it.
vi.mock("~/database/db.server", () => ({ db: {} }));

const slice = {
  id: "ba-1",
  bookingId: "b-1",
  assetId: "pool-1",
  quantity: 10,
  assetKitId: null,
};

describe("unitsStillOutBySlice", () => {
  it("subtracts the logs that name the slice", () => {
    const out = unitsStillOutBySlice({
      sourced: [{ ...slice, checkedOutQuantity: 10 }],
      siblings: [slice],
      logs: [
        {
          bookingId: "b-1",
          assetId: "pool-1",
          bookingAssetId: "ba-1",
          quantity: 4,
        },
        {
          bookingId: "b-1",
          assetId: "pool-1",
          bookingAssetId: "ba-1",
          quantity: 2,
        },
      ],
    });
    expect(out.get("ba-1")).toBe(4);
  });

  it("counts a log from an older app that names no slice against the asset's only slice", () => {
    const out = unitsStillOutBySlice({
      sourced: [{ ...slice, checkedOutQuantity: 10 }],
      siblings: [slice],
      logs: [
        {
          bookingId: "b-1",
          assetId: "pool-1",
          bookingAssetId: null,
          quantity: 6,
        },
      ],
    });
    expect(out.get("ba-1")).toBe(4);
  });

  it("fills untagged units in the booking page's order: standalone slice first", () => {
    const kitSlice = {
      ...slice,
      id: "ba-kit",
      assetKitId: "ak-1",
      quantity: 5,
    };
    const out = unitsStillOutBySlice({
      sourced: [{ ...slice, checkedOutQuantity: 10 }],
      siblings: [slice, kitSlice],
      logs: [
        {
          bookingId: "b-1",
          assetId: "pool-1",
          bookingAssetId: null,
          quantity: 7,
        },
      ],
    });
    // The standalone slice takes all 7 before the kit slice gets any.
    expect(out.get("ba-1")).toBe(3);
  });

  it("ignores logs from another booking", () => {
    const out = unitsStillOutBySlice({
      sourced: [{ ...slice, checkedOutQuantity: 10 }],
      siblings: [slice],
      logs: [
        {
          bookingId: "b-2",
          assetId: "pool-1",
          bookingAssetId: null,
          quantity: 6,
        },
      ],
    });
    expect(out.get("ba-1")).toBe(10);
  });
});
