/**
 * The request version an approval approves: every kind of change to what a
 * reservation request holds changes it, so an approval against the version an
 * approver saw is refused after any of them, whichever write made the change
 * (a kit edit propagating slices, a quantity change, a removal, a model
 * reservation change, or an edit of the booking itself).
 *
 * @see {@link file://./request-version.server.ts}
 */
import { describe, expect, it } from "vitest";
import { hashRequest } from "./request-version.server";

// @vitest-environment node

const REVIEWED = {
  updatedAt: new Date("2026-11-16T10:00:00.000Z"),
  bookingAssets: [
    { id: "ba-1", assetId: "asset-1", assetKitId: null, quantity: 1 },
    { id: "ba-2", assetId: "asset-2", assetKitId: "ak-1", quantity: 3 },
  ],
  modelRequests: [{ assetModelId: "model-1", quantity: 2 }],
};

const reviewed = hashRequest(REVIEWED);

describe("hashRequest", () => {
  it("is the same for the same request in any order", () => {
    expect(
      hashRequest({
        ...REVIEWED,
        bookingAssets: [...REVIEWED.bookingAssets].reverse(),
      })
    ).toBe(reviewed);
  });

  it.each([
    [
      "a kit edit adds a slice",
      {
        ...REVIEWED,
        bookingAssets: [
          ...REVIEWED.bookingAssets,
          { id: "ba-3", assetId: "asset-3", assetKitId: "ak-1", quantity: 1 },
        ],
      },
    ],
    [
      "a slice's amount changes",
      {
        ...REVIEWED,
        bookingAssets: [
          REVIEWED.bookingAssets[0],
          { ...REVIEWED.bookingAssets[1], quantity: 5 },
        ],
      },
    ],
    [
      "a slice is removed",
      { ...REVIEWED, bookingAssets: [REVIEWED.bookingAssets[0]] },
    ],
    [
      "a slice moves to another kit",
      {
        ...REVIEWED,
        bookingAssets: [
          REVIEWED.bookingAssets[0],
          { ...REVIEWED.bookingAssets[1], assetKitId: "ak-2" },
        ],
      },
    ],
    [
      "a model reservation changes",
      {
        ...REVIEWED,
        modelRequests: [{ assetModelId: "model-1", quantity: 4 }],
      },
    ],
    [
      "the booking itself is edited",
      { ...REVIEWED, updatedAt: new Date("2026-11-16T10:05:00.000Z") },
    ],
  ])("changes when %s", (_label, changed) => {
    expect(hashRequest(changed)).not.toBe(reviewed);
  });
});
