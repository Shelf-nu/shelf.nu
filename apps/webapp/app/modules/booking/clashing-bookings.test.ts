import { describe, expect, it } from "vitest";
import {
  describeClashingBookings,
  earliestClashStart,
} from "./clashing-bookings";

describe("describeClashingBookings", () => {
  const kits = new Map([
    ["m-1", { id: "kit-1", name: "Kit Alpha" }],
    ["m-2", { id: "kit-1", name: "Kit Alpha" }],
  ]);

  it("names the shared items per booking, kits once, earliest booking first", () => {
    const result = describeClashingBookings(
      [
        {
          id: "b-late",
          name: "December job",
          from: new Date("2026-12-02T08:00:00Z"),
          bookingAssets: [
            { assetId: "a-9", assetKitId: null, asset: { title: "Cam 9" } },
          ],
        },
        {
          id: "b-soon",
          name: "November job",
          from: new Date("2026-11-12T08:00:00Z"),
          bookingAssets: [
            { assetId: "a-7", assetKitId: null, asset: { title: "Cam 7" } },
            { assetId: "a-3", assetKitId: null, asset: { title: "Cam 3" } },
            { assetId: "a-3", assetKitId: null, asset: { title: "Cam 3" } },
            { assetId: "a-k1", assetKitId: "m-1", asset: { title: "Lens" } },
            { assetId: "a-k2", assetKitId: "m-2", asset: { title: "Body" } },
          ],
        },
      ],
      kits
    );

    expect(result).toEqual([
      {
        id: "b-soon",
        name: "November job",
        from: "2026-11-12T08:00:00.000Z",
        items: [
          { id: "a-3", name: "Cam 3", kind: "asset" },
          { id: "a-7", name: "Cam 7", kind: "asset" },
          { id: "kit-1", name: "Kit Alpha", kind: "kit" },
        ],
      },
      {
        id: "b-late",
        name: "December job",
        from: "2026-12-02T08:00:00.000Z",
        items: [{ id: "a-9", name: "Cam 9", kind: "asset" }],
      },
    ]);
  });

  it("reports a kit-driven slice as its asset when the kit is not one this booking holds", () => {
    const [booking] = describeClashingBookings(
      [
        {
          id: "b",
          name: "Job",
          from: "2026-11-12T08:00:00Z",
          bookingAssets: [
            {
              assetId: "a-1",
              assetKitId: "m-other",
              asset: { title: "Cam 1" },
            },
          ],
        },
      ],
      kits
    );
    expect(booking.items).toEqual([
      { id: "a-1", name: "Cam 1", kind: "asset" },
    ]);
  });

  it("tolerates rows without items or start, as older callers and mocks send them", () => {
    expect(describeClashingBookings([{ id: "b", name: "Job" }])).toEqual([
      { id: "b", name: "Job", from: "", items: [] },
    ]);
  });

  it("sorts item names numerically so Cam 2 precedes Cam 10", () => {
    const [booking] = describeClashingBookings([
      {
        id: "b",
        name: "Job",
        bookingAssets: [
          { assetId: "a-10", asset: { title: "Cam 10" } },
          { assetId: "a-2", asset: { title: "Cam 2" } },
          { assetId: "a-blank", asset: { title: "  " } },
        ],
      },
    ]);
    expect(booking.items.map((i) => i.name)).toEqual([
      "Cam 2",
      "Cam 10",
      "Untitled asset",
    ]);
  });
});

describe("earliestClashStart", () => {
  it("is the first start, ignoring bookings without one", () => {
    expect(
      earliestClashStart([
        { id: "a", name: "A", from: "", items: [] },
        { id: "b", name: "B", from: "2026-12-01T00:00:00.000Z", items: [] },
        { id: "c", name: "C", from: "2026-11-01T00:00:00.000Z", items: [] },
      ])
    ).toBe("2026-11-01T00:00:00.000Z");
    expect(earliestClashStart([])).toBeUndefined();
  });
});
