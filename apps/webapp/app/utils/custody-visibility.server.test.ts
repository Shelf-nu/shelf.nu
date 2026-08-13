/**
 * Server-side custody redaction.
 *
 * `TeamMemberBadge` decides whether to DRAW a custodian's name, but the loader
 * shipped that name — and `user.email` — to every viewer regardless. A BASE
 * user with `baseUserCanSeeCustody` off saw "private" on screen while
 * `/kits.data` carried the custodian's name in plain text.
 *
 * These tests pin the server-side half: the identity must not leave the server
 * unless the viewer is allowed it, while the row itself still arrives so the
 * badge can render "private" and own-custody rows keep showing the owner.
 *
 * @see {@link file://./custody-visibility.server.ts}
 * @see {@link file://./permissions/custody-and-bookings-permissions.validator.client.ts}
 */
import { describe, expect, it } from "vitest";

import { redactCustodianForViewer } from "./custody-visibility.server";

const VIEWER = "user-viewer";
const COLLEAGUE = "user-colleague";

/** A row shaped like the list includes produce. */
function rowHeldBy(userId: string | null, name = "Someone Else") {
  return {
    id: "kit-1",
    name: "Ranged Equipment",
    custody: {
      custodian: {
        userId,
        name,
        user: userId
          ? {
              id: userId,
              firstName: "Some",
              lastName: "One",
              displayName: null,
              profilePicture: null,
              email: "someone@example.com",
            }
          : null,
      },
    },
  };
}

describe("redactCustodianForViewer", () => {
  it("leaves everything alone when the viewer may see all custody", () => {
    const rows = [rowHeldBy(COLLEAGUE)];

    const out = redactCustodianForViewer(rows, {
      canSeeAllCustody: true,
      userId: VIEWER,
    });

    expect(out[0].custody?.custodian?.name).toBe("Someone Else");
    expect(out[0].custody?.custodian?.user?.email).toBe("someone@example.com");
  });

  it("strips a colleague's identity when the viewer may not see all custody", () => {
    const rows = [rowHeldBy(COLLEAGUE)];

    const out = redactCustodianForViewer(rows, {
      canSeeAllCustody: false,
      userId: VIEWER,
    });

    // The leak: name and email used to ship regardless of the badge's gate.
    expect(JSON.stringify(out)).not.toContain("Someone Else");
    expect(JSON.stringify(out)).not.toContain("someone@example.com");
  });

  it("keeps the row itself so the badge can still render `private`", () => {
    const rows = [rowHeldBy(COLLEAGUE)];

    const out = redactCustodianForViewer(rows, {
      canSeeAllCustody: false,
      userId: VIEWER,
    });

    // Dropping `custody` entirely would turn the "private" chip into a blank
    // cell, losing the signal that the item IS held by someone.
    expect(out[0].custody).toBeTruthy();
    expect(out[0].custody?.custodian).toBeTruthy();
  });

  it("keeps the viewer's OWN custody visible", () => {
    const rows = [rowHeldBy(VIEWER, "Me Myself")];

    const out = redactCustodianForViewer(rows, {
      canSeeAllCustody: false,
      userId: VIEWER,
    });

    // `userCanViewSpecificCustody` allows this, so redacting it would be a
    // regression: the owner would see "private" on their own item.
    expect(out[0].custody?.custodian?.name).toBe("Me Myself");
    expect(out[0].custody?.custodian?.user?.id).toBe(VIEWER);
  });

  it("strips an NRM custodian, who has no user to compare against", () => {
    const rows = [rowHeldBy(null, "Woox")];

    const out = redactCustodianForViewer(rows, {
      canSeeAllCustody: false,
      userId: VIEWER,
    });

    // The exact case observed in the browser: NRM custodians have no user, so
    // a "is this me?" check can never match — they must be redacted.
    expect(JSON.stringify(out)).not.toContain("Woox");
    expect(out[0].custody?.custodian).toBeTruthy();
  });

  it("leaves rows with no custody untouched", () => {
    const rows = [{ id: "kit-2", name: "Free", custody: null }];

    const out = redactCustodianForViewer(rows, {
      canSeeAllCustody: false,
      userId: VIEWER,
    });

    expect(out[0].custody).toBeNull();
  });

  /**
   * Assets carry an ARRAY of custody rows, not one — a quantity-tracked asset
   * can be split across several custodians at once (`Custody.quantity`). An
   * array is truthy and has no `.custodian`, so a helper written only for the
   * object shape skips every asset silently.
   */
  describe("assets, where custody is an array", () => {
    /** An asset row with its units split between two custodians. */
    const splitAsset = () => ({
      id: "asset-1",
      title: "Dell Latitude",
      custody: [
        {
          quantity: 3,
          custodian: {
            userId: COLLEAGUE,
            name: "Someone Else",
            user: { id: COLLEAGUE, email: "someone@example.com" },
          },
        },
        {
          quantity: 2,
          custodian: {
            userId: VIEWER,
            name: "Me Myself",
            user: { id: VIEWER, email: "me@example.com" },
          },
        },
      ],
    });

    it("redacts each colleague entry while keeping the viewer's own", () => {
      const out = redactCustodianForViewer([splitAsset()], {
        canSeeAllCustody: false,
        userId: VIEWER,
      });

      const serialized = JSON.stringify(out);
      expect(serialized).not.toContain("Someone Else");
      expect(serialized).not.toContain("someone@example.com");
      // The viewer's own slice survives.
      expect(serialized).toContain("Me Myself");
    });

    it("preserves the array length and each entry's quantity", () => {
      const out = redactCustodianForViewer([splitAsset()], {
        canSeeAllCustody: false,
        userId: VIEWER,
      });

      const custody = out[0].custody as Array<{ quantity: number }>;
      // Dropping or collapsing entries would corrupt the custody breakdown.
      expect(custody).toHaveLength(2);
      expect(custody.map((c) => c.quantity)).toEqual([3, 2]);
    });

    it("leaves an empty custody array alone", () => {
      const out = redactCustodianForViewer([{ id: "a", custody: [] }], {
        canSeeAllCustody: false,
        userId: VIEWER,
      });

      expect(out[0].custody).toEqual([]);
    });
  });

  it("does not mutate the caller's array", () => {
    const rows = [rowHeldBy(COLLEAGUE)];

    redactCustodianForViewer(rows, {
      canSeeAllCustody: false,
      userId: VIEWER,
    });

    // Prisma results get reused by callers; redaction must not reach back.
    expect(rows[0].custody?.custodian?.name).toBe("Someone Else");
  });
});

describe("redactCustodianForViewer — booking-derived custody", () => {
  /** A CHECKED_OUT row: no `custody`, holder comes from the booking. */
  const checkedOutByColleague = {
    id: "asset-1",
    custody: [],
    bookingAssets: [
      {
        booking: {
          id: "booking-1",
          custodianUserId: "someone-else",
          custodianTeamMember: {
            id: "tm-colleague",
            name: "Colleague Name",
            userId: "someone-else",
          },
          custodianUser: { id: "someone-else", email: "colleague@example.com" },
        },
      },
    ],
  };

  it("empties the booking custodian a restricted viewer may not see", () => {
    const [row] = redactCustodianForViewer([checkedOutByColleague], {
      canSeeAllCustody: false,
      userId: "me",
    });

    // The bug this pins: redacting only `custody` emptied the COPY that
    // `updateAssetsWithBookingCustodians` makes, while the source rode along
    // in the same payload under `bookingAssets`.
    expect(row.bookingAssets[0].booking.custodianTeamMember.name).toBe("");
    expect(row.bookingAssets[0].booking.custodianUser).toBeNull();
    // The scalar FK is identity too: an opaque uuid still links rows to one
    // holder, and `ORGANIZATION_SELECT_FIELDS` ships `owner: { id, email }` to
    // every role, so it resolves outright when the holder is the owner.
    expect(row.bookingAssets[0].booking.custodianUserId).toBeNull();
    expect(JSON.stringify(row)).not.toContain("Colleague Name");
    expect(JSON.stringify(row)).not.toContain("colleague@example.com");
    expect(JSON.stringify(row)).not.toContain("someone-else");
  });

  it("keeps a booking the viewer holds themselves", () => {
    const [row] = redactCustodianForViewer([checkedOutByColleague], {
      canSeeAllCustody: false,
      userId: "someone-else",
    });

    // Over-redacting here would print "private" on an item the viewer booked.
    expect(row.bookingAssets[0].booking.custodianTeamMember.name).toBe(
      "Colleague Name"
    );
  });

  it("leaves everything alone for a viewer who may see all custody", () => {
    const [row] = redactCustodianForViewer([checkedOutByColleague], {
      canSeeAllCustody: true,
      userId: "me",
    });

    expect(row.bookingAssets[0].booking.custodianTeamMember.name).toBe(
      "Colleague Name"
    );
  });

  it("tolerates rows with no bookingAssets at all", () => {
    const [row] = redactCustodianForViewer(
      [{ id: "kit-1", custody: { custodian: { name: "X", userId: "other" } } }],
      { canSeeAllCustody: false, userId: "me" }
    );

    expect(row.custody.custodian.name).toBe("");
  });

  it("descends into the kits index nesting (assetKits[].asset.bookingAssets)", () => {
    // A kit's holder comes from its MEMBER assets' bookings, so the same
    // custodian sits one level deeper than on the asset index. A top-level
    // probe alone misses every one of them.
    const kitRow = {
      id: "kit-1",
      custody: null,
      assetKits: [
        {
          id: "ak-1",
          asset: {
            id: "asset-1",
            bookingAssets: [
              {
                booking: {
                  id: "booking-1",
                  custodianUserId: "someone-else",
                  custodianTeamMember: {
                    id: "tm-colleague",
                    name: "Colleague Name",
                    userId: "someone-else",
                  },
                  custodianUser: { id: "someone-else" },
                },
              },
            ],
          },
        },
      ],
    };

    const [row] = redactCustodianForViewer([kitRow], {
      canSeeAllCustody: false,
      userId: "me",
    });

    expect(
      row.assetKits[0].asset.bookingAssets[0].booking.custodianTeamMember.name
    ).toBe("");
    // `kits._index` is the ONE loader that selects this scalar, and it selects
    // it exactly here — inside the availability nesting.
    expect(
      row.assetKits[0].asset.bookingAssets[0].booking.custodianUserId
    ).toBeNull();
    expect(JSON.stringify(row)).not.toContain("Colleague Name");
    expect(JSON.stringify(row)).not.toContain("someone-else");
  });
});
