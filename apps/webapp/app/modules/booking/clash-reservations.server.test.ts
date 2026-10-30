/**
 * The shared clash reader behind the extend guard and the booking page's
 * horizon: which reservations count as a clash, how a held kit widens the
 * search, and what a reader who may not see other bookings is told.
 *
 * @see {@link file://./clash-reservations.server.ts}
 */
import { BookingStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  findClashingReservations,
  resolveHeldKits,
  type ClashClient,
  type HeldKits,
} from "./clash-reservations.server";

// @vitest-environment node

const AFTER = new Date("2026-11-01T17:00:00.000Z");
const UNTIL = new Date("2026-11-05T17:00:00.000Z");
const NO_KITS: HeldKits = { membershipIds: [], kitByMembershipId: new Map() };
const ADMIN = { userId: "user-1", seesAllBookings: true };

/** A client whose two queries answer with the given rows. */
function clientWith({
  memberships = [],
  bookings = [],
}: {
  memberships?: unknown[][];
  bookings?: unknown[];
}) {
  const assetKitFindMany = vi.fn();
  for (const rows of memberships) assetKitFindMany.mockResolvedValueOnce(rows);
  const bookingFindMany = vi.fn().mockResolvedValue(bookings);
  const client = {
    assetKit: { findMany: assetKitFindMany },
    booking: { findMany: bookingFindMany },
  } as unknown as ClashClient;
  return { client, assetKitFindMany, bookingFindMany };
}

/** A clashing booking row as the query returns it. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "b-2",
    name: "Camera day",
    from: new Date("2026-11-03T08:00:00.000Z"),
    creatorId: "user-2",
    custodianUserId: "user-2",
    bookingAssets: [
      { assetId: "cam-1", assetKitId: null, asset: { title: "Cam 1" } },
    ],
    ...overrides,
  };
}

describe("resolveHeldKits", () => {
  it("widens the memberships still out to every membership of their kits", async () => {
    const { client, assetKitFindMany } = clientWith({
      memberships: [
        [{ kitId: "kit-1", kit: { name: "Case A" } }],
        [
          { id: "ak-1", kitId: "kit-1" },
          { id: "ak-2", kitId: "kit-1" },
        ],
      ],
    });

    const held = await resolveHeldKits({
      client,
      organizationId: "org-1",
      membershipIdsStillOut: ["ak-1"],
    });

    expect(held.membershipIds).toEqual(["ak-1", "ak-2"]);
    expect(held.kitByMembershipId.get("ak-2")).toEqual({
      id: "kit-1",
      name: "Case A",
    });
    expect(assetKitFindMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { kitId: { in: ["kit-1"] }, organizationId: "org-1" },
      })
    );
  });

  it("asks nothing when no kit is out", async () => {
    const { client, assetKitFindMany } = clientWith({});
    const held = await resolveHeldKits({
      client,
      organizationId: "org-1",
      membershipIdsStillOut: [],
    });
    expect(held.membershipIds).toEqual([]);
    expect(assetKitFindMany).not.toHaveBeenCalled();
  });
});

describe("findClashingReservations", () => {
  it("looks for other RESERVED bookings of this workspace starting inside (after, until]", async () => {
    const { client, bookingFindMany } = clientWith({ bookings: [] });

    await findClashingReservations({
      client,
      organizationId: "org-1",
      bookingId: "b-1",
      activeAssetIds: ["cam-1"],
      heldKits: NO_KITS,
      after: AFTER,
      until: UNTIL,
      viewer: ADMIN,
    });

    expect(bookingFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { not: "b-1" },
          organizationId: "org-1",
          status: { in: [BookingStatus.RESERVED] },
          bookingAssets: { some: { assetId: { in: ["cam-1"] } } },
          from: { gt: AFTER, lte: UNTIL },
        },
        orderBy: { from: "asc" },
      })
    );
  });

  it("has no upper bound without `until`, and matches held kit memberships too", async () => {
    const { client, bookingFindMany } = clientWith({ bookings: [] });

    await findClashingReservations({
      client,
      organizationId: "org-1",
      bookingId: "b-1",
      activeAssetIds: ["cam-1"],
      heldKits: { membershipIds: ["ak-1"], kitByMembershipId: new Map() },
      after: AFTER,
      viewer: ADMIN,
    });

    const { where } = bookingFindMany.mock.calls[0][0];
    expect(where.from).toEqual({ gt: AFTER });
    expect(where.bookingAssets).toEqual({
      some: {
        OR: [{ assetId: { in: ["cam-1"] } }, { assetKitId: { in: ["ak-1"] } }],
      },
    });
  });

  it("asks nothing when nothing is out", async () => {
    const { client, bookingFindMany } = clientWith({});
    const result = await findClashingReservations({
      client,
      organizationId: "org-1",
      bookingId: "b-1",
      activeAssetIds: [],
      heldKits: NO_KITS,
      after: AFTER,
      viewer: ADMIN,
    });
    expect(result).toEqual([]);
    expect(bookingFindMany).not.toHaveBeenCalled();
  });

  it("names the booking for a viewer who may see all bookings", async () => {
    const { client } = clientWith({ bookings: [row()] });
    const [clash] = await findClashingReservations({
      client,
      organizationId: "org-1",
      bookingId: "b-1",
      activeAssetIds: ["cam-1"],
      heldKits: NO_KITS,
      after: AFTER,
      viewer: ADMIN,
    });
    expect(clash).toEqual({
      id: "b-2",
      name: "Camera day",
      from: "2026-11-03T08:00:00.000Z",
      items: [{ id: "cam-1", name: "Cam 1", kind: "asset" }],
    });
  });

  it("hides other members' bookings but keeps the viewer's own", async () => {
    const { client } = clientWith({
      bookings: [
        row(),
        row({
          id: "b-own",
          name: "My shoot",
          creatorId: "user-1",
          from: new Date("2026-11-04T08:00:00.000Z"),
        }),
        row({
          id: "b-custody",
          name: "Held for me",
          creatorId: "user-3",
          custodianUserId: "user-1",
          from: new Date("2026-11-04T09:00:00.000Z"),
        }),
      ],
    });

    const clashes = await findClashingReservations({
      client,
      organizationId: "org-1",
      bookingId: "b-1",
      activeAssetIds: ["cam-1"],
      heldKits: NO_KITS,
      after: AFTER,
      viewer: { userId: "user-1", seesAllBookings: false },
    });

    expect(clashes.map((c) => [c.id, c.name])).toEqual([
      [null, "another booking"],
      ["b-own", "My shoot"],
      ["b-custody", "Held for me"],
    ]);
    // The items and the start stay, so the reader knows what to free.
    expect(clashes[0].items).toEqual([
      { id: "cam-1", name: "Cam 1", kind: "asset" },
    ]);
  });
});
