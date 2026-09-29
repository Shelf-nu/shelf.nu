/**
 * Unit tests for the booking custody read gate.
 *
 * `canSeeBooking` is the single predicate behind every booking detail-level
 * read gate (overview loader, activity loader, activity note action, activity
 * CSV export). The cases below pin down the two directions that matter:
 *
 * - A booking whose custody is recorded ONLY on the team-member link must stay
 *   readable by the user that team member belongs to. Matching the user link
 *   alone fails closed here, which is what made rows appear on the index and
 *   then 403 on click.
 * - Another user's booking must still be refused — this is what proves the
 *   fix above did not widen access.
 *
 * @see {@link file://./booking-authorization.server.ts}
 */
import type { BookingStatus } from "@prisma/client";
import { OrganizationRoles } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { accessFor } from "@helpers/role-access";
import {
  assertCanAddBookingItems,
  assertCanDeleteBooking,
  assertCanDownloadBookingDocuments,
  bookingAddableStatusClause,
  bookingWriteScopeClause,
  canSeeBooking,
  canSeeBookingCustodian,
  isBookingCustodian,
  resolveBookingCustodianName,
  validateBookingOwnership,
  WITHHELD_CUSTODIAN_NAME,
} from "./booking-authorization.server";
import type { RoleAccess } from "./permissions/role-access";

const ME = "user-me";
const SOMEONE_ELSE = "user-victim";

describe("canSeeBooking", () => {
  describe("when the caller cannot see all bookings", () => {
    it("allows a booking held via the user link", () => {
      expect(
        canSeeBooking({
          access: accessFor([OrganizationRoles.BASE]),
          booking: { custodianUserId: ME, custodianTeamMember: null },
          userId: ME,
        })
      ).toBe(true);
    });

    /**
     * The legacy class this gate exists for: assigned to a team member while no
     * user was attached, linked only later when the invite was accepted. The
     * booking never gets a `custodianUserId`, so the user link alone can't see
     * it — yet the index lists it.
     */
    it("allows a legacy booking held via the team-member link alone", () => {
      expect(
        canSeeBooking({
          access: accessFor([OrganizationRoles.BASE]),
          booking: {
            custodianUserId: null,
            custodianTeamMember: { userId: ME },
          },
          userId: ME,
        })
      ).toBe(true);
    });

    it("refuses another user's booking on both links", () => {
      expect(
        canSeeBooking({
          access: accessFor([OrganizationRoles.BASE]),
          booking: {
            custodianUserId: SOMEONE_ELSE,
            custodianTeamMember: { userId: SOMEONE_ELSE },
          },
          userId: ME,
        })
      ).toBe(false);
    });

    it("refuses a booking whose team member belongs to another user", () => {
      expect(
        canSeeBooking({
          access: accessFor([OrganizationRoles.BASE]),
          booking: {
            custodianUserId: null,
            custodianTeamMember: { userId: SOMEONE_ELSE },
          },
          userId: ME,
        })
      ).toBe(false);
    });

    /**
     * An unlinked team member (`userId: null`) must never match. Without the
     * explicit requester comparison a nullish-vs-nullish check would hand every
     * unclaimed booking to any caller.
     */
    it("refuses a booking whose team member has no user attached", () => {
      expect(
        canSeeBooking({
          access: accessFor([OrganizationRoles.BASE]),
          booking: {
            custodianUserId: null,
            custodianTeamMember: { userId: null },
          },
          userId: ME,
        })
      ).toBe(false);
    });

    it("refuses an unassigned booking", () => {
      expect(
        canSeeBooking({
          access: accessFor([OrganizationRoles.BASE]),
          booking: { custodianUserId: null, custodianTeamMember: null },
          userId: ME,
        })
      ).toBe(false);
    });

    it("refuses when the team-member relation was not selected", () => {
      expect(
        canSeeBooking({
          access: accessFor([OrganizationRoles.BASE]),
          booking: { custodianUserId: SOMEONE_ELSE },
          userId: ME,
        })
      ).toBe(false);
    });
  });

  describe("when the caller can see all bookings", () => {
    it("allows another user's booking", () => {
      expect(
        canSeeBooking({
          access: accessFor([OrganizationRoles.ADMIN]),
          booking: {
            custodianUserId: SOMEONE_ELSE,
            custodianTeamMember: { userId: SOMEONE_ELSE },
          },
          userId: ME,
        })
      ).toBe(true);
    });

    it("allows another user's booking when a restricted role's workspace toggle is on", () => {
      expect(
        canSeeBooking({
          access: accessFor([OrganizationRoles.SELF_SERVICE], {
            selfServiceCanSeeBookings: true,
          }),
          booking: {
            custodianUserId: SOMEONE_ELSE,
            custodianTeamMember: { userId: SOMEONE_ELSE },
          },
          userId: ME,
        })
      ).toBe(true);
    });
  });
});

/**
 * A booking reduced to the two columns both the clause and the gate read.
 */
type BookingRow = { creatorId: string | null; custodianUserId: string | null };

/**
 * Evaluates the clause against a row, the way Postgres would.
 *
 * Deliberately narrow: it understands ONLY the `{ OR: [{ field: value }, …] }`
 * shape {@link bookingWriteScopeClause} emits, and throws on anything else. If
 * the clause grows a construct this cannot evaluate, the equivalence test below
 * fails loudly instead of quietly passing on an unchecked predicate.
 *
 * @param clause - The where-input under test.
 * @param row - The candidate booking.
 * @returns Whether the row would be returned by a query carrying the clause.
 */
function rowMatches(
  clause: Record<string, unknown> | undefined,
  row: BookingRow
): boolean {
  if (!clause) {
    return true; // No restriction — every row qualifies.
  }

  const branches = clause.OR;

  if (!Array.isArray(branches)) {
    throw new Error(
      `Unsupported clause shape: ${JSON.stringify(
        clause
      )}. Extend rowMatches to cover it.`
    );
  }

  return branches.some((branch: Record<string, unknown>) =>
    Object.entries(branch).every(([field, value]) => {
      if (typeof value !== "string") {
        throw new Error(`Unsupported branch: ${JSON.stringify(branch)}`);
      }
      return row[field as keyof BookingRow] === value;
    })
  );
}

/**
 * Runs the submit-time gate and reports whether it let the caller through.
 *
 * @param row - The candidate booking.
 * @param access - The caller's access.
 * @returns `true` when {@link validateBookingOwnership} does not throw.
 */
function gateAllows(row: BookingRow, access: RoleAccess): boolean {
  try {
    validateBookingOwnership({
      booking: row,
      userId: ME,
      access,
      action: "test",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * The point of the clause: it is the query-side mirror of the submit-time gate.
 * Any row a picker offers must be one the action will accept, or the user hits
 * a 403 dead end, so these two must agree on EVERY row, for EVERY role and
 * workspace toggle.
 */
describe("bookingWriteScopeClause", () => {
  const ROWS: Array<{ label: string; row: BookingRow }> = [
    {
      label: "created and custodied by me",
      row: { creatorId: ME, custodianUserId: ME },
    },
    {
      label: "created by me, custodied by someone else",
      row: { creatorId: ME, custodianUserId: SOMEONE_ELSE },
    },
    {
      label: "created by someone else, custodied by me",
      row: { creatorId: SOMEONE_ELSE, custodianUserId: ME },
    },
    {
      label: "entirely someone else's",
      row: { creatorId: SOMEONE_ELSE, custodianUserId: SOMEONE_ELSE },
    },
    {
      label: "unassigned with no creator",
      row: { creatorId: null, custodianUserId: null },
    },
  ];

  const ROLES = [
    OrganizationRoles.SELF_SERVICE,
    OrganizationRoles.BASE,
    OrganizationRoles.ADMIN,
    OrganizationRoles.OWNER,
  ];
  const TOGGLES = [
    {},
    { selfServiceCanSeeBookings: true, baseUserCanSeeBookings: true },
  ];

  for (const role of ROLES) {
    for (const workspace of TOGGLES) {
      for (const { label, row } of ROWS) {
        it(`agrees with validateBookingOwnership for ${role} (toggles ${JSON.stringify(
          workspace
        )}) on a booking ${label}`, () => {
          const access = accessFor([role], workspace);
          const clause = bookingWriteScopeClause({ userId: ME, access }) as
            | Record<string, unknown>
            | undefined;
          expect(rowMatches(clause, row)).toBe(gateAllows(row, access));
        });
      }
    }
  }

  it.each([OrganizationRoles.ADMIN, OrganizationRoles.OWNER])(
    "returns no restriction for %s",
    (role) => {
      expect(
        bookingWriteScopeClause({ userId: ME, access: accessFor([role]) })
      ).toBeUndefined();
    }
  );

  it.each([OrganizationRoles.SELF_SERVICE, OrganizationRoles.BASE])(
    "restricts %s to bookings they created or hold, even with the see-toggle on",
    (role) => {
      expect(
        bookingWriteScopeClause({
          userId: ME,
          access: accessFor([role], {
            selfServiceCanSeeBookings: true,
            baseUserCanSeeBookings: true,
          }),
        })
      ).toEqual({ OR: [{ creatorId: ME }, { custodianUserId: ME }] });
    }
  );

  it("restricts a membership with no known role rather than waving it through", () => {
    expect(
      bookingWriteScopeClause({
        userId: ME,
        access: accessFor(["AUDITOR" as OrganizationRoles]),
      })
    ).toEqual({ OR: [{ creatorId: ME }, { custodianUserId: ME }] });
  });
});

describe("validateBookingOwnership", () => {
  const others = { creatorId: SOMEONE_ELSE, custodianUserId: SOMEONE_ELSE };

  it("refuses SELF_SERVICE on someone else's booking even when the workspace lets them see it", () => {
    expect(() =>
      validateBookingOwnership({
        booking: others,
        userId: ME,
        access: accessFor([OrganizationRoles.SELF_SERVICE], {
          selfServiceCanSeeBookings: true,
        }),
        action: "edit",
      })
    ).toThrow(expect.objectContaining({ status: 403 }));
  });

  it("lets a mixed [SELF_SERVICE, ADMIN] membership write any booking", () => {
    expect(() =>
      validateBookingOwnership({
        booking: others,
        userId: ME,
        access: accessFor([
          OrganizationRoles.SELF_SERVICE,
          OrganizationRoles.ADMIN,
        ]),
        action: "edit",
      })
    ).not.toThrow();
  });
});

describe("assertCanDeleteBooking", () => {
  const mine = (status: BookingStatus) => ({
    creatorId: ME,
    custodianUserId: null,
    status,
  });

  it.each([OrganizationRoles.BASE, OrganizationRoles.SELF_SERVICE])(
    "holds %s to its own DRAFT bookings",
    (role) => {
      const access = accessFor([role]);
      expect(() =>
        assertCanDeleteBooking({ access, booking: mine("DRAFT"), userId: ME })
      ).not.toThrow();
      expect(() =>
        assertCanDeleteBooking({
          access,
          booking: mine("RESERVED"),
          userId: ME,
        })
      ).toThrow(expect.objectContaining({ status: 403 }));
    }
  );

  it("refuses a restricted role on someone else's draft", () => {
    expect(() =>
      assertCanDeleteBooking({
        access: accessFor([OrganizationRoles.BASE]),
        booking: {
          creatorId: SOMEONE_ELSE,
          custodianUserId: SOMEONE_ELSE,
          status: "DRAFT",
        },
        userId: ME,
      })
    ).toThrow(expect.objectContaining({ status: 403 }));
  });

  it("lets ADMIN delete any booking in any status", () => {
    expect(() =>
      assertCanDeleteBooking({
        access: accessFor([OrganizationRoles.ADMIN]),
        booking: {
          creatorId: SOMEONE_ELSE,
          custodianUserId: null,
          status: "ONGOING",
        },
        userId: ME,
      })
    ).not.toThrow();
  });
});

/**
 * Naming a booking's holder.
 *
 * Three surfaces ask this question of the same rows — the mobile bookings
 * list, the calendar lens on that same screen, and Home. They resolve it here
 * so they cannot answer it differently for one booking.
 *
 * The three-way answer is the part that matters: a name, `null` for a booking
 * nobody holds, and the withheld sentinel for one held by someone this viewer
 * may not see. Collapsing the last two reports an unassigned booking as a
 * withheld one, which reads as "someone has this and you may not know who".
 */
describe("resolveBookingCustodianName", () => {
  const NAMED_USER = {
    id: SOMEONE_ELSE,
    displayName: "Ada Lovelace",
    firstName: "Augusta",
    lastName: "King",
  };

  it("returns null when the booking has no custodian at all", () => {
    expect(
      resolveBookingCustodianName({
        canSeeAllCustody: true,
        booking: { custodianUser: null, custodianTeamMember: null },
        userId: ME,
      })
    ).toBeNull();
  });

  it("withholds another user's name when custody visibility is off", () => {
    expect(
      resolveBookingCustodianName({
        canSeeAllCustody: false,
        booking: { custodianUser: NAMED_USER, custodianTeamMember: null },
        userId: ME,
      })
    ).toBe(WITHHELD_CUSTODIAN_NAME);
  });

  it("names the custodian when the workspace grants custody visibility", () => {
    expect(
      resolveBookingCustodianName({
        canSeeAllCustody: true,
        booking: { custodianUser: NAMED_USER, custodianTeamMember: null },
        userId: ME,
      })
    ).toBe("Ada Lovelace");
  });

  it("shows callers their own name through the user link", () => {
    expect(
      resolveBookingCustodianName({
        canSeeAllCustody: false,
        booking: {
          custodianUser: { ...NAMED_USER, id: ME },
          custodianTeamMember: null,
        },
        userId: ME,
      })
    ).toBe("Ada Lovelace");
  });

  it("shows callers their own name through the team-member link alone", () => {
    // Custody assigned by picking a TEAM MEMBER leaves `custodianUser` null.
    // Matching the user link alone hides a booking's holder from the very
    // person holding it.
    expect(
      resolveBookingCustodianName({
        canSeeAllCustody: false,
        booking: {
          custodianUser: null,
          custodianTeamMember: { name: "Ada L.", userId: ME },
        },
        userId: ME,
      })
    ).toBe("Ada L.");
  });

  it("prefers the team-member name when both links are set", () => {
    // Web's bookings list resolves it this way (`list-bookings-content.tsx`).
    // The two normally agree because `TeamMember.name` tracks
    // `User.displayName`; when they drift, web's answer is the one every
    // surface has to give.
    expect(
      resolveBookingCustodianName({
        canSeeAllCustody: true,
        booking: {
          custodianUser: NAMED_USER,
          custodianTeamMember: { name: "Ada from Ops", userId: SOMEONE_ELSE },
        },
        userId: ME,
      })
    ).toBe("Ada from Ops");
  });

  it("withholds a team-member custodian who is not the caller", () => {
    expect(
      resolveBookingCustodianName({
        canSeeAllCustody: false,
        booking: {
          custodianUser: null,
          custodianTeamMember: { name: "Ada L.", userId: SOMEONE_ELSE },
        },
        userId: ME,
      })
    ).toBe(WITHHELD_CUSTODIAN_NAME);
  });

  it("withholds a non-user team member from a restricted viewer", () => {
    // A team member with no account behind it belongs to nobody, so it can
    // never be the caller.
    expect(
      resolveBookingCustodianName({
        canSeeAllCustody: false,
        booking: {
          custodianUser: null,
          custodianTeamMember: { name: "Loading Bay", userId: null },
        },
        userId: ME,
      })
    ).toBe(WITHHELD_CUSTODIAN_NAME);
  });
});

describe("canSeeBookingCustodian", () => {
  it("gates the custodian's face the same way as their name", () => {
    // The list serves a profile picture beside the name. A face identifies as
    // well as a name does, so the two must never come apart.
    const booking = {
      custodianUser: { id: SOMEONE_ELSE, displayName: "Ada Lovelace" },
      custodianTeamMember: null,
    };

    expect(
      canSeeBookingCustodian({ canSeeAllCustody: false, booking, userId: ME })
    ).toBe(false);
    expect(
      canSeeBookingCustodian({ canSeeAllCustody: true, booking, userId: ME })
    ).toBe(true);
  });
});

describe("isBookingCustodian", () => {
  it("matches the user link", () => {
    expect(
      isBookingCustodian({
        booking: { custodianUserId: "me", custodianTeamMember: null },
        userId: "me",
      })
    ).toBe(true);
  });

  it("matches a booking held through the team-member link alone", () => {
    expect(
      isBookingCustodian({
        booking: {
          custodianUserId: null,
          custodianTeamMember: { userId: "me" },
        },
        userId: "me",
      })
    ).toBe(true);
  });

  it("refuses another user's booking on both links", () => {
    expect(
      isBookingCustodian({
        booking: {
          custodianUserId: "other",
          custodianTeamMember: { userId: "other" },
        },
        userId: "me",
      })
    ).toBe(false);
  });
});

describe("assertCanDownloadBookingDocuments", () => {
  const notMine = { custodianUserId: "someone-else" };

  it.each([OrganizationRoles.OWNER, OrganizationRoles.ADMIN])(
    "%s downloads any booking's documents",
    (role) => {
      expect(() =>
        assertCanDownloadBookingDocuments({
          access: accessFor([role]),
          booking: notMine,
          userId: "me",
          action: "view",
        })
      ).not.toThrow();
    }
  );

  it.each([OrganizationRoles.SELF_SERVICE, OrganizationRoles.BASE])(
    "%s downloads only as the custodian",
    (role) => {
      expect(() =>
        assertCanDownloadBookingDocuments({
          access: accessFor([role]),
          booking: { custodianUserId: "me" },
          userId: "me",
          action: "view",
        })
      ).not.toThrow();
      expect(() =>
        assertCanDownloadBookingDocuments({
          access: accessFor([role]),
          booking: notMine,
          userId: "me",
          action: "view",
        })
      ).toThrow(expect.objectContaining({ status: 403 }));
    }
  );

  it("is not widened by the booking see-toggle", () => {
    expect(() =>
      assertCanDownloadBookingDocuments({
        access: accessFor([OrganizationRoles.SELF_SERVICE], {
          selfServiceCanSeeBookings: true,
        }),
        booking: notMine,
        userId: "me",
        action: "view",
      })
    ).toThrow(expect.objectContaining({ status: 403 }));
  });
});

describe("assertCanAddBookingItems", () => {
  const OPEN_AFTER_DRAFT = ["RESERVED", "ONGOING", "OVERDUE"] as const;

  it.each([OrganizationRoles.SELF_SERVICE, OrganizationRoles.BASE])(
    "lets %s add items to a DRAFT",
    (role) => {
      expect(() =>
        assertCanAddBookingItems({
          access: accessFor([role]),
          bookingStatus: "DRAFT",
        })
      ).not.toThrow();
    }
  );

  it.each(
    [OrganizationRoles.SELF_SERVICE, OrganizationRoles.BASE].flatMap((role) =>
      OPEN_AFTER_DRAFT.map((status) => [role, status] as const)
    )
  )("refuses %s adding items to a %s booking with a 403", (role, status) => {
    expect(() =>
      assertCanAddBookingItems({
        access: accessFor([role]),
        bookingStatus: status,
      })
    ).toThrow(expect.objectContaining({ status: 403 }));
  });

  it.each(
    [OrganizationRoles.OWNER, OrganizationRoles.ADMIN].flatMap((role) =>
      OPEN_AFTER_DRAFT.map((status) => [role, status] as const)
    )
  )("lets %s add items to a %s booking", (role, status) => {
    expect(() =>
      assertCanAddBookingItems({
        access: accessFor([role]),
        bookingStatus: status,
      })
    ).not.toThrow();
  });

  it("refuses everyone on a closed booking", () => {
    expect(() =>
      assertCanAddBookingItems({
        access: accessFor([OrganizationRoles.OWNER]),
        bookingStatus: "COMPLETE",
      })
    ).toThrow(expect.objectContaining({ status: 403 }));
  });
});

describe("bookingAddableStatusClause", () => {
  it.each([OrganizationRoles.OWNER, OrganizationRoles.ADMIN])(
    "adds no filter for %s, who may add to every open status",
    (role) => {
      expect(
        bookingAddableStatusClause({ access: accessFor([role]) })
      ).toBeUndefined();
    }
  );

  it.each([OrganizationRoles.SELF_SERVICE, OrganizationRoles.BASE])(
    "limits %s to drafts",
    (role) => {
      expect(bookingAddableStatusClause({ access: accessFor([role]) })).toEqual(
        { status: { in: ["DRAFT"] } }
      );
    }
  );
});
