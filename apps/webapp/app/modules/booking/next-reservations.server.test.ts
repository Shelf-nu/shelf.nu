/**
 * What a running booking's items are promised to next: the extend horizon
 * and the per-row "Needed" badges the booking page shows.
 *
 * @see {@link file://./next-reservations.server.ts}
 */
import { AssetStatus, AssetType, BookingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadNextReservations,
  NO_NEXT_RESERVATIONS,
} from "./next-reservations.server";

// @vitest-environment node

const { bookingFindFirst, bookingFindMany, assetKitFindMany } = vi.hoisted(
  () => ({
    bookingFindFirst: vi.fn(),
    bookingFindMany: vi.fn(),
    assetKitFindMany: vi.fn(),
  })
);

// why: the reader's outcome depends only on the rows Prisma returns; no
// database is needed to measure the shaping and the where-clauses
vi.mock("~/database/db.server", () => ({
  db: {
    booking: { findFirst: bookingFindFirst, findMany: bookingFindMany },
    assetKit: { findMany: assetKitFindMany },
  },
}));

const OUT_AT = new Date("2026-11-01T09:00:00.000Z");
const ADMIN = { userId: "user-1", seesAllBookings: true };

/** One slice of the running booking. */
function slice({
  assetId,
  type = AssetType.INDIVIDUAL,
  assetKitId = null,
}: {
  assetId: string;
  type?: AssetType;
  assetKitId?: string | null;
}) {
  return {
    assetId,
    assetKitId,
    checkedOutAt: OUT_AT,
    checkedInAt: null,
    asset: { id: assetId, status: AssetStatus.CHECKED_OUT, type },
  };
}

/** The running booking, holding the given slices. */
function runningBooking(slices: ReturnType<typeof slice>[]) {
  return {
    status: BookingStatus.ONGOING,
    to: new Date("2026-11-02T17:00:00.000Z"),
    bookingAssets: slices,
    partialCheckins: [],
  };
}

/** A clashing booking row as the clash query returns it. */
function clashRow(
  id: string,
  from: string,
  bookingAssets: { assetId: string; assetKitId?: string | null }[]
) {
  return {
    id,
    name: `Booking ${id}`,
    from: new Date(from),
    creatorId: "user-2",
    custodianUserId: null,
    bookingAssets: bookingAssets.map((ba) => ({
      assetKitId: null,
      ...ba,
      asset: { title: ba.assetId },
    })),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("loadNextReservations", () => {
  it("reports nothing for a booking that is not running", async () => {
    bookingFindFirst.mockResolvedValue({
      ...runningBooking([slice({ assetId: "cam-1" })]),
      status: BookingStatus.RESERVED,
    });

    const result = await loadNextReservations({
      organizationId: "org-1",
      bookingId: "b-1",
      viewer: ADMIN,
    });

    expect(result).toBe(NO_NEXT_RESERVATIONS);
    expect(bookingFindMany).not.toHaveBeenCalled();
  });

  it("never looks up a quantity-tracked pool by name", async () => {
    bookingFindFirst.mockResolvedValue(
      runningBooking([
        slice({ assetId: "cam-1" }),
        slice({ assetId: "cable", type: AssetType.QUANTITY_TRACKED }),
      ])
    );
    bookingFindMany.mockResolvedValue([]);

    await loadNextReservations({
      organizationId: "org-1",
      bookingId: "b-1",
      viewer: ADMIN,
    });

    const { where } = bookingFindMany.mock.calls[0][0];
    expect(where.bookingAssets).toEqual({
      some: { assetId: { in: ["cam-1"] } },
    });
  });

  it("gives each item its earliest reservation and the horizon the first clash", async () => {
    bookingFindFirst.mockResolvedValue(
      runningBooking([slice({ assetId: "cam-1" }), slice({ assetId: "cam-2" })])
    );
    bookingFindMany.mockResolvedValue([
      clashRow("b-late", "2026-11-09T08:00:00.000Z", [
        { assetId: "cam-1" },
        { assetId: "cam-2" },
      ]),
      clashRow("b-soon", "2026-11-04T08:00:00.000Z", [{ assetId: "cam-1" }]),
    ]);

    const result = await loadNextReservations({
      organizationId: "org-1",
      bookingId: "b-1",
      viewer: ADMIN,
    });

    expect(result.horizon?.freeUntil).toBe("2026-11-04T08:00:00.000Z");
    expect(result.horizon?.blockedBy.id).toBe("b-soon");
    expect(result.byAssetId["cam-1"].bookingId).toBe("b-soon");
    expect(result.byAssetId["cam-2"].bookingId).toBe("b-late");
  });

  it("files a kit held through its memberships under the kit, not its members", async () => {
    bookingFindFirst.mockResolvedValue(
      runningBooking([slice({ assetId: "lens", assetKitId: "ak-1" })])
    );
    assetKitFindMany
      .mockResolvedValueOnce([{ kitId: "kit-1", kit: { name: "Case A" } }])
      .mockResolvedValueOnce([{ id: "ak-1", kitId: "kit-1" }]);
    bookingFindMany.mockResolvedValue([
      clashRow("b-2", "2026-11-04T08:00:00.000Z", [
        { assetId: "lens", assetKitId: "ak-1" },
      ]),
    ]);

    const result = await loadNextReservations({
      organizationId: "org-1",
      bookingId: "b-1",
      viewer: ADMIN,
    });

    expect(result.byKitId["kit-1"].bookingId).toBe("b-2");
    expect(result.byAssetId).toEqual({});
  });

  it("names no other member's booking for a viewer who may not see it", async () => {
    bookingFindFirst.mockResolvedValue(
      runningBooking([slice({ assetId: "cam-1" })])
    );
    bookingFindMany.mockResolvedValue([
      clashRow("b-2", "2026-11-04T08:00:00.000Z", [{ assetId: "cam-1" }]),
    ]);

    const result = await loadNextReservations({
      organizationId: "org-1",
      bookingId: "b-1",
      viewer: { userId: "user-1", seesAllBookings: false },
    });

    expect(result.byAssetId["cam-1"]).toEqual({
      bookingId: null,
      bookingName: "another booking",
      from: "2026-11-04T08:00:00.000Z",
    });
    expect(result.horizon?.blockedBy.id).toBeNull();
  });
});
