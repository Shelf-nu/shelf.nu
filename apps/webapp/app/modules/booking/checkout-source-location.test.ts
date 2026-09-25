import { describe, expect, it } from "vitest";

import type {
  PoolSourceSnapshot,
  SliceSourceInput,
} from "./checkout-source-location";
import {
  checkinPlacementSources,
  checkoutSourceOptions,
  defaultSourceLocationId,
  parseSourceLocationsFromFormData,
  poolAsksForSource,
  resolveSliceSource,
  sliceForDisposition,
  sourceLocationFieldName,
  sourceSubmissionFromRecord,
  submittedSourceForSlice,
} from "./checkout-source-location";

const cameraRoom = {
  locationId: "loc-camera",
  name: "Camera Room",
  placed: 60,
  inCustody: 0,
  onBooking: 0,
  left: 60,
};
const studio = {
  locationId: "loc-studio",
  name: "Studio",
  placed: 40,
  inCustody: 0,
  onBooking: 0,
  left: 40,
};

function snapshot(
  placements: PoolSourceSnapshot["placements"],
  unplaced = 0
): PoolSourceSnapshot {
  return { placements, unplaced };
}

function input(overrides: Partial<SliceSourceInput> = {}): SliceSourceInput {
  return {
    checkedOutQuantity: 0,
    isKitSlice: false,
    kitLocationId: null,
    submitted: undefined,
    snapshot: snapshot([cameraRoom, studio]),
    ...overrides,
  };
}

describe("poolAsksForSource", () => {
  it("asks only for a pool at two or more manual placements", () => {
    expect(poolAsksForSource(snapshot([]))).toBe(false);
    expect(poolAsksForSource(snapshot([], 10))).toBe(false);
    expect(poolAsksForSource(snapshot([cameraRoom]))).toBe(false);
    expect(poolAsksForSource(snapshot([cameraRoom], 25))).toBe(false);
    expect(poolAsksForSource(snapshot([cameraRoom, studio]))).toBe(true);
  });
});

describe("defaultSourceLocationId", () => {
  it("records nothing for a pool with no placements", () => {
    expect(defaultSourceLocationId(snapshot([], 100))).toBeNull();
  });

  it("records the only placement when no units are unplaced", () => {
    expect(defaultSourceLocationId(snapshot([cameraRoom]))).toBe("loc-camera");
  });

  it("records nothing for one placement next to unplaced units", () => {
    expect(defaultSourceLocationId(snapshot([cameraRoom], 5))).toBeNull();
  });

  it("picks the placement with the most units left", () => {
    expect(
      defaultSourceLocationId(
        snapshot([
          { ...cameraRoom, left: 12 },
          { ...studio, left: 30 },
        ])
      )
    ).toBe("loc-studio");
  });

  it("goes by units left, not units placed", () => {
    // Camera Room holds more, but most of it is already in custody.
    expect(
      defaultSourceLocationId(
        snapshot([
          { ...cameraRoom, placed: 60, inCustody: 0, onBooking: 0, left: 5 },
          { ...studio, placed: 40, inCustody: 0, onBooking: 0, left: 40 },
        ])
      )
    ).toBe("loc-studio");
  });

  it("keeps the earliest placement on a tie", () => {
    expect(
      defaultSourceLocationId(
        snapshot([
          { ...cameraRoom, left: 20 },
          { ...studio, left: 20 },
        ])
      )
    ).toBe("loc-camera");
  });

  it("never picks the unplaced units on its own for a multi-placed pool", () => {
    expect(
      defaultSourceLocationId(
        snapshot(
          [
            { ...cameraRoom, left: 3 },
            { ...studio, left: 2 },
          ],
          500
        )
      )
    ).toBe("loc-camera");
  });
});

describe("resolveSliceSource", () => {
  it("keeps the recorded source when the slice was sent out before", () => {
    expect(
      resolveSliceSource(
        input({
          checkedOutQuantity: 4,
          submitted: { locationId: "loc-studio" },
        })
      )
    ).toEqual({ action: "keep" });
  });

  it("records the kit's location for a kit slice and ignores any answer", () => {
    expect(
      resolveSliceSource(
        input({
          isKitSlice: true,
          kitLocationId: "loc-kit-shelf",
          submitted: { locationId: "loc-studio" },
        })
      )
    ).toEqual({ action: "record", locationId: "loc-kit-shelf", reason: "kit" });
  });

  it("records nothing for a kit slice whose kit has no location", () => {
    expect(
      resolveSliceSource(input({ isKitSlice: true, kitLocationId: null }))
    ).toEqual({ action: "record", locationId: null, reason: "kit" });
  });

  it("records the submitted placement", () => {
    expect(
      resolveSliceSource(input({ submitted: { locationId: "loc-studio" } }))
    ).toEqual({
      action: "record",
      locationId: "loc-studio",
      reason: "submitted",
    });
  });

  it("records an explicit Unplaced as nothing while the pool has unplaced units", () => {
    expect(
      resolveSliceSource(
        input({
          submitted: { locationId: null },
          snapshot: snapshot([cameraRoom, studio], 12),
        })
      )
    ).toEqual({ action: "record", locationId: null, reason: "unplaced" });
  });

  it("flags Unplaced for a pool with no unplaced units", () => {
    expect(
      resolveSliceSource(input({ submitted: { locationId: null } }))
    ).toEqual({ action: "invalid", locationId: null });
  });
  it("flags a submitted location the pool is not placed at", () => {
    expect(
      resolveSliceSource(input({ submitted: { locationId: "loc-elsewhere" } }))
    ).toEqual({ action: "invalid", locationId: "loc-elsewhere" });
  });

  it("falls back to the most-left placement when nothing was submitted (old phone app)", () => {
    expect(
      resolveSliceSource(
        input({
          snapshot: snapshot([
            { ...cameraRoom, left: 10 },
            { ...studio, left: 40 },
          ]),
        })
      )
    ).toEqual({
      action: "record",
      locationId: "loc-studio",
      reason: "most-left",
    });
  });

  it("names why nothing was recorded for 0 and 1+unplaced placements", () => {
    expect(resolveSliceSource(input({ snapshot: snapshot([], 9) }))).toEqual({
      action: "record",
      locationId: null,
      reason: "no-placement",
    });
    expect(
      resolveSliceSource(input({ snapshot: snapshot([cameraRoom], 9) }))
    ).toEqual({
      action: "record",
      locationId: null,
      reason: "placement-and-unplaced",
    });
    expect(
      resolveSliceSource(input({ snapshot: snapshot([cameraRoom]) }))
    ).toEqual({
      action: "record",
      locationId: "loc-camera",
      reason: "only-placement",
    });
  });
});

describe("submissions", () => {
  it("reads the per-slice fields from a form, with '' as Unplaced", () => {
    const formData = new FormData();
    formData.set("intent", "checkOut");
    formData.set(sourceLocationFieldName("ba-1"), "loc-studio");
    formData.set(sourceLocationFieldName("ba-2"), "");
    const submission = parseSourceLocationsFromFormData(formData);
    expect([...submission.entries()]).toEqual([
      ["ba-1", "loc-studio"],
      ["ba-2", null],
    ]);
  });

  it("reads the mobile record, treating null and '' as Unplaced", () => {
    const submission = sourceSubmissionFromRecord({
      "ba-1": "loc-camera",
      "asset-2": null,
      "asset-3": "",
    });
    expect([...submission.entries()]).toEqual([
      ["ba-1", "loc-camera"],
      ["asset-2", null],
      ["asset-3", null],
    ]);
    expect(sourceSubmissionFromRecord(undefined).size).toBe(0);
  });

  it("prefers a slice-keyed answer over an asset-keyed one", () => {
    const submission = sourceSubmissionFromRecord({
      "ba-1": "loc-camera",
      "asset-1": "loc-studio",
    });
    expect(
      submittedSourceForSlice(submission, { id: "ba-1", assetId: "asset-1" })
    ).toEqual({ locationId: "loc-camera" });
    expect(
      submittedSourceForSlice(submission, { id: "ba-9", assetId: "asset-1" })
    ).toEqual({ locationId: "loc-studio" });
    expect(
      submittedSourceForSlice(submission, { id: "ba-9", assetId: "asset-9" })
    ).toBeUndefined();
  });
});

describe("checkinPlacementSources", () => {
  const standalone = { assetKitId: null, sourceLocationId: "loc-studio" };

  it("takes consumed, lost and damaged off the recorded location", () => {
    expect(
      checkinPlacementSources({
        slice: standalone,
        consumed: 6,
        lost: 1,
        damaged: 2,
      })
    ).toEqual([{ locationId: "loc-studio", quantity: 9 }]);
  });

  it("leaves placements alone when everything came back", () => {
    expect(checkinPlacementSources({ slice: standalone })).toEqual([]);
  });

  it("names no placement for a slice with no source, a kit slice, or an unknown slice", () => {
    expect(
      checkinPlacementSources({
        slice: { assetKitId: null, sourceLocationId: null },
        consumed: 3,
      })
    ).toEqual([]);
    expect(
      checkinPlacementSources({
        slice: { assetKitId: "ak-1", sourceLocationId: "loc-kit-shelf" },
        consumed: 3,
      })
    ).toEqual([]);
    expect(checkinPlacementSources({ slice: null, consumed: 3 })).toEqual([]);
  });
});

describe("sliceForDisposition", () => {
  const slices = [
    { id: "ba-1", assetId: "pool-1", assetKitId: null, sourceLocationId: "a" },
    {
      id: "ba-2",
      assetId: "pool-1",
      assetKitId: "ak-1",
      sourceLocationId: "k",
    },
    { id: "ba-3", assetId: "pool-2", assetKitId: null, sourceLocationId: "b" },
  ];

  it("returns the slice a disposition names", () => {
    expect(
      sliceForDisposition(slices, { assetId: "pool-1", bookingAssetId: "ba-2" })
        ?.id
    ).toBe("ba-2");
  });

  it("refuses a named slice that belongs to another asset", () => {
    expect(
      sliceForDisposition(slices, { assetId: "pool-2", bookingAssetId: "ba-1" })
    ).toBeNull();
  });

  it("returns the asset's only slice for an untagged disposition", () => {
    expect(sliceForDisposition(slices, { assetId: "pool-2" })?.id).toBe("ba-3");
  });

  it("guesses nothing when an untagged asset has several slices", () => {
    expect(sliceForDisposition(slices, { assetId: "pool-1" })).toBeNull();
  });
});

describe("checkoutSourceOptions", () => {
  it("names custody and bookings on a location the same way the location page does", () => {
    expect(
      checkoutSourceOptions({
        unitOfMeasure: "pcs",
        unplaced: 5,
        placements: [
          { ...cameraRoom, inCustody: 10, onBooking: 20, left: 30 },
          studio,
        ],
      }).map((option) => option.label)
    ).toEqual([
      "Camera Room · 60 pcs · 10 in custody · 20 on a booking",
      "Studio · 40 pcs",
      "Unplaced · 5 pcs",
    ]);
  });
});
