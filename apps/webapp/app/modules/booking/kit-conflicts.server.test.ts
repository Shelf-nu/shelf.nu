/**
 * Tests for the kit-level booking conflict lookup.
 *
 * The lookup answers "which of these kits does another overlapping booking
 * hold?". It has two halves that can each go wrong without anything visible
 * breaking: the query must find only LIVE kit-driven slices of the requested
 * kits in the conflict window, and the grouping must attribute each slice to the
 * right kit before the conflict rule runs. A query that also matched detached
 * rows, or a grouping that merged two kits, would still return plausible names.
 *
 * @see {@link file://./kit-conflicts.server.ts}
 */
import { BookingStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { findConflictingKits } from "./kit-conflicts.server";

// @vitest-environment node

const FROM = new Date("2026-09-20T09:00:00Z");
const TO = new Date("2026-09-22T17:00:00Z");
const OUT = new Date("2026-09-19T09:00:00Z");

type Membership = { id: string; kitId: string; kit: { name: string } };
type Slice = {
  assetKitId: string;
  checkedOutAt: Date | null;
  checkedInAt: Date | null;
  booking: { id: string; status: BookingStatus };
};

/**
 * why: the subject is the query this module builds and how it groups the rows,
 * not what a database returns. The client is injected, so a stub standing in
 * for the two delegates it reads is enough — no module mock.
 */
function stubClient(memberships: Membership[], slices: Slice[]) {
  const client = {
    assetKit: { findMany: vi.fn().mockResolvedValue(memberships) },
    bookingAsset: { findMany: vi.fn().mockResolvedValue(slices) },
  };
  return client;
}

const baseArgs = {
  kitIds: ["kit-a", "kit-b"],
  bookingId: "booking-current",
  from: FROM,
  to: TO,
  organizationId: "org-1",
};

describe("findConflictingKits", () => {
  it("returns nothing without querying when there are no kits or no window", async () => {
    const client = stubClient([], []);

    await expect(
      findConflictingKits({ ...baseArgs, kitIds: [] }, client as never)
    ).resolves.toEqual([]);
    await expect(
      findConflictingKits({ ...baseArgs, to: null }, client as never)
    ).resolves.toEqual([]);

    expect(client.assetKit.findMany).not.toHaveBeenCalled();
    expect(client.bookingAsset.findMany).not.toHaveBeenCalled();
  });

  it("scopes the membership lookup to the requested kits and organization", async () => {
    const client = stubClient([], []);

    await findConflictingKits(baseArgs, client as never);

    expect(client.assetKit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { kitId: { in: ["kit-a", "kit-b"] }, organizationId: "org-1" },
      })
    );
  });

  it("reads only live kit-driven slices of those memberships, in the conflict window, in the organization", async () => {
    const client = stubClient(
      [{ id: "ak-a1", kitId: "kit-a", kit: { name: "Projector case" } }],
      []
    );

    await findConflictingKits(baseArgs, client as never);

    const { where } = client.bookingAsset.findMany.mock.calls[0][0];
    // Detached rows carry `assetKitId: null`, so matching by membership id is
    // what keeps a standalone asset from counting as the kit.
    expect(where.assetKitId).toEqual({ in: ["ak-a1"] });
    expect(where.booking.organizationId).toBe("org-1");
    // The same RESERVED / ONGOING / OVERDUE window assets are checked against,
    // with the current booking excluded.
    const windowClauses = where.booking.OR;
    expect(windowClauses).toHaveLength(2);
    expect(windowClauses[0]).toMatchObject({
      status: BookingStatus.RESERVED,
      id: { not: "booking-current" },
    });
    expect(windowClauses[1]).toMatchObject({
      status: { in: [BookingStatus.ONGOING, BookingStatus.OVERDUE] },
      id: { not: "booking-current" },
    });
  });

  it("skips the slice query when none of the kits has a membership", async () => {
    const client = stubClient([], []);

    await expect(
      findConflictingKits(baseArgs, client as never)
    ).resolves.toEqual([]);
    expect(client.bookingAsset.findMany).not.toHaveBeenCalled();
  });

  it("names each conflicting kit once, judging each kit on its own slices", async () => {
    const client = stubClient(
      [
        { id: "ak-a1", kitId: "kit-a", kit: { name: "Projector case" } },
        { id: "ak-a2", kitId: "kit-a", kit: { name: "Projector case" } },
        { id: "ak-b1", kitId: "kit-b", kit: { name: "Clamp set" } },
      ],
      [
        // Kit A: two members on a reservation that overlaps — one conflict.
        {
          assetKitId: "ak-a1",
          checkedOutAt: null,
          checkedInAt: null,
          booking: { id: "other", status: BookingStatus.RESERVED },
        },
        {
          assetKitId: "ak-a2",
          checkedOutAt: null,
          checkedInAt: null,
          booking: { id: "other", status: BookingStatus.RESERVED },
        },
        // Kit B: on a live booking but already returned — no conflict.
        {
          assetKitId: "ak-b1",
          checkedOutAt: OUT,
          checkedInAt: new Date("2026-09-20T10:00:00Z"),
          booking: { id: "live", status: BookingStatus.ONGOING },
        },
      ]
    );

    await expect(
      findConflictingKits(baseArgs, client as never)
    ).resolves.toEqual([{ id: "kit-a", name: "Projector case" }]);
  });

  it("lets an in-flight booking ignore reservations but not a kit still out", async () => {
    const memberships = [
      { id: "ak-a1", kitId: "kit-a", kit: { name: "Projector case" } },
      { id: "ak-b1", kitId: "kit-b", kit: { name: "Clamp set" } },
    ];
    const slices = [
      {
        assetKitId: "ak-a1",
        checkedOutAt: null,
        checkedInAt: null,
        booking: { id: "other", status: BookingStatus.RESERVED },
      },
      {
        assetKitId: "ak-b1",
        checkedOutAt: OUT,
        checkedInAt: null,
        booking: { id: "live", status: BookingStatus.OVERDUE },
      },
    ];

    await expect(
      findConflictingKits(
        { ...baseArgs, ignoreReservedConflicts: true },
        stubClient(memberships, slices) as never
      )
    ).resolves.toEqual([{ id: "kit-b", name: "Clamp set" }]);
  });
});
