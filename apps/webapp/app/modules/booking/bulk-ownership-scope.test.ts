/**
 * Bulk booking actions — ownership scope
 *
 * The bookings list scopes a BASE / SELF_SERVICE user to their own bookings,
 * but the bulk where-builder applied only `organizationId` and an optional
 * status. So `bookingIds=["all-selected"]` deleted, archived or cancelled every
 * matching booking in the workspace — other people's included — from a list
 * that had only ever shown the caller their own.
 *
 * The explicit-id branch was equally unscoped, so posting a guessed id worked
 * too. Both branches are covered here.
 *
 * Regression coverage for detail.dev finding D031.
 *
 * @see {@link file://./utils.server.ts}
 * @see {@link file://./../../utils/booking-authorization.server.ts} validateBookingOwnership — the singular gate this mirrors
 */

import { OrganizationRoles } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { accessFor } from "@helpers/role-access";
import { ALL_SELECTED_KEY } from "~/utils/list";
import {
  assertBulkSelectionWithinOwnership,
  getBookingOwnershipScope,
  getBulkBookingsWhereInput,
} from "./utils.server";

// @vitest-environment node

const ORG = "org-1";
const ME = "user-me";

const RESTRICTED = [OrganizationRoles.BASE, OrganizationRoles.SELF_SERVICE];
const UNRESTRICTED = [OrganizationRoles.ADMIN, OrganizationRoles.OWNER];

/** Every ownership predicate the clause ended up matching on */
function ownershipBranches(
  where: ReturnType<typeof getBulkBookingsWhereInput>
) {
  const and = (where.AND ?? []) as Array<{ OR?: unknown[] }>;
  const scope = [and].flat().find((clause) => clause?.OR);
  return (scope?.OR ?? []) as Array<Record<string, string>>;
}

describe("getBookingOwnershipScope", () => {
  it.each(UNRESTRICTED)("does not restrict %s", (role) => {
    expect(
      getBookingOwnershipScope({ access: accessFor([role]), userId: ME })
    ).toBeNull();
  });

  it.each(RESTRICTED)("restricts %s to their own bookings", (role) => {
    expect(
      getBookingOwnershipScope({ access: accessFor([role]), userId: ME })
    ).toEqual({
      OR: [{ creatorId: ME }, { custodianUserId: ME }],
    });
  });

  it("fails closed when a restricted role has no user to scope to", () => {
    // Returning null here would silently widen to the whole workspace
    expect(() =>
      getBookingOwnershipScope({
        access: accessFor([OrganizationRoles.BASE]),
      })
    ).toThrow();
  });

  it("restricts an unrecognised role rather than waving it through", () => {
    // An unknown role resolves to the least privileged policy, so it is scoped
    // to its own rows rather than handed org-wide delete.
    expect(
      getBookingOwnershipScope({
        access: accessFor(["AUDITOR" as OrganizationRoles]),
        userId: ME,
      })
    ).toEqual({
      OR: [{ creatorId: ME }, { custodianUserId: ME }],
    });
  });

  it.each(RESTRICTED)(
    "still scopes %s to its own rows when the workspace lets it see every booking",
    (role) => {
      expect(
        getBookingOwnershipScope({
          access: accessFor([role], {
            selfServiceCanSeeBookings: true,
            baseUserCanSeeBookings: true,
          }),
          userId: ME,
        })
      ).toEqual({ OR: [{ creatorId: ME }, { custodianUserId: ME }] });
    }
  );
});

describe("getBulkBookingsWhereInput — select all", () => {
  it.each(RESTRICTED)("scopes %s to their own bookings", (role) => {
    const where = getBulkBookingsWhereInput({
      bookingIds: [ALL_SELECTED_KEY],
      organizationId: ORG,
      currentSearchParams: "status=DRAFT",
      access: accessFor([role]),
      userId: ME,
    });

    expect(ownershipBranches(where)).toEqual([
      { creatorId: ME },
      { custodianUserId: ME },
    ]);
    // The list filter still applies — this narrows, it does not replace
    expect(JSON.stringify(where)).toContain("DRAFT");
  });

  it.each(UNRESTRICTED)("leaves %s unscoped", (role) => {
    const where = getBulkBookingsWhereInput({
      bookingIds: [ALL_SELECTED_KEY],
      organizationId: ORG,
      currentSearchParams: "status=DRAFT",
      access: accessFor([role]),
      userId: ME,
    });

    expect(where.AND).toBeUndefined();
    expect(where.organizationId).toBe(ORG);
  });
});

describe("getBulkBookingsWhereInput — explicit ids", () => {
  it.each(RESTRICTED)("scopes %s even when ids are posted directly", (role) => {
    // Guessing another user's booking id must not be enough — the list never
    // showed it, but the id alone used to be sufficient.
    const where = getBulkBookingsWhereInput({
      bookingIds: ["someone-elses-booking"],
      organizationId: ORG,
      access: accessFor([role]),
      userId: ME,
    });

    expect(ownershipBranches(where)).toEqual([
      { creatorId: ME },
      { custodianUserId: ME },
    ]);
    expect(JSON.stringify(where)).toContain("someone-elses-booking");
  });

  it.each(UNRESTRICTED)("leaves %s unscoped", (role) => {
    const where = getBulkBookingsWhereInput({
      bookingIds: ["bk-1", "bk-2"],
      organizationId: ORG,
      access: accessFor([role]),
      userId: ME,
    });

    expect(where).toEqual({
      id: { in: ["bk-1", "bk-2"] },
      organizationId: ORG,
    });
  });
});

describe("getBulkBookingsWhereInput — composition", () => {
  it("intersects rather than unions the ownership clause", () => {
    // A spread-merge would put ownership into the same OR as the filters,
    // widening a destructive query instead of narrowing it.
    const where = getBulkBookingsWhereInput({
      bookingIds: [ALL_SELECTED_KEY],
      organizationId: ORG,
      currentSearchParams: "status=DRAFT",
      access: accessFor([OrganizationRoles.SELF_SERVICE]),
      userId: ME,
    });

    expect(Array.isArray(where.AND)).toBe(true);
    expect(where.OR).toBeUndefined();
  });
});

describe("assertBulkSelectionWithinOwnership", () => {
  it.each(RESTRICTED)(
    "refuses %s when a selected booking was scoped out as someone else's",
    (role) => {
      expect(() =>
        assertBulkSelectionWithinOwnership({
          bookingIds: ["mine", "theirs"],
          foundIds: ["mine"],
          access: accessFor([role]),
          action: "archive",
        })
      ).toThrow(expect.objectContaining({ status: 403 }));
    }
  );

  it.each(RESTRICTED)("lets %s act on a selection of their own", (role) => {
    expect(() =>
      assertBulkSelectionWithinOwnership({
        bookingIds: ["mine", "also-mine"],
        foundIds: ["also-mine", "mine"],
        access: accessFor([role]),
        action: "archive",
      })
    ).not.toThrow();
  });

  it.each(RESTRICTED)("leaves select-all to its filters for %s", (role) => {
    expect(() =>
      assertBulkSelectionWithinOwnership({
        bookingIds: [ALL_SELECTED_KEY],
        foundIds: [],
        access: accessFor([role]),
        action: "cancel",
      })
    ).not.toThrow();
  });

  it.each(UNRESTRICTED)("never refuses %s", (role) => {
    expect(() =>
      assertBulkSelectionWithinOwnership({
        bookingIds: ["a", "b"],
        foundIds: ["a"],
        access: accessFor([role]),
        action: "delete",
      })
    ).not.toThrow();
  });
});
