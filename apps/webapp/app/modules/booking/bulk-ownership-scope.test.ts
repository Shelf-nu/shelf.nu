/**
 * Bulk booking actions: ownership scope
 *
 * A caller who may not write every booking (BASE / SELF_SERVICE) may only
 * delete, archive or cancel bookings they created or hold, whether they post
 * explicit ids or "Select all". Both branches of the bulk where-builder are
 * covered here. Which rows "Select all" stands for is covered in
 * `bulk-select-all-matches-list.server.test.ts`.
 *
 * Regression coverage for detail.dev finding D031.
 *
 * @see {@link file://./utils.server.ts} `getBookingOwnershipScope`
 * @see {@link file://./service.server.ts} `getBulkBookingsWhereInput`
 * @see {@link file://./../../utils/booking-authorization.server.ts} validateBookingOwnership — the singular gate this mirrors
 */

import { BookingStatus, OrganizationRoles } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { accessFor } from "@helpers/role-access";
import { ALL_SELECTED_KEY } from "~/utils/list";
import { getBulkBookingsWhereInput } from "./service.server";
import {
  assertBulkSelectionWithinOwnership,
  getBookingOwnershipScope,
} from "./utils.server";

// @vitest-environment node

// why: select-all resolves a restricted caller's custodian scope through
// `resolveCustodianScope`, which reads their team-member rows.
vitest.mock("~/database/db.server", () => ({
  db: { teamMember: { findMany: vitest.fn().mockResolvedValue([]) } },
}));

const ORG = "org-1";
const ME = "user-me";

const RESTRICTED = [OrganizationRoles.BASE, OrganizationRoles.SELF_SERVICE];
const UNRESTRICTED = [OrganizationRoles.ADMIN, OrganizationRoles.OWNER];

/** Bookings that are not drafts, plus the caller's own drafts. */
const ONLY_MY_DRAFTS = {
  OR: [
    { status: { not: BookingStatus.DRAFT } },
    { AND: [{ status: BookingStatus.DRAFT }, { creatorId: ME }] },
  ],
};

/** Every ownership predicate the clause ended up matching on */
function ownershipBranches(
  where: Awaited<ReturnType<typeof getBulkBookingsWhereInput>>
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

describe("getBulkBookingsWhereInput: select all", () => {
  it.each(RESTRICTED)("scopes %s to their own bookings", async (role) => {
    const where = await getBulkBookingsWhereInput({
      bookingIds: [ALL_SELECTED_KEY],
      list: { kind: "index" },
      organizationId: ORG,
      currentSearchParams: "status=DRAFT",
      access: accessFor([role]),
      userId: ME,
    });

    // The list's own rows, narrowed to the ones the caller may write
    expect(where).toEqual({
      AND: [
        {
          organizationId: ORG,
          AND: [ONLY_MY_DRAFTS, { custodianUserId: ME }],
          status: { in: [BookingStatus.DRAFT] },
        },
        { OR: [{ creatorId: ME }, { custodianUserId: ME }] },
      ],
    });
  });

  it.each(UNRESTRICTED)("leaves %s to the list's own rows", async (role) => {
    const where = await getBulkBookingsWhereInput({
      bookingIds: [ALL_SELECTED_KEY],
      list: { kind: "index" },
      organizationId: ORG,
      currentSearchParams: "status=DRAFT",
      access: accessFor([role]),
      userId: ME,
    });

    expect(where).toEqual({
      organizationId: ORG,
      AND: [ONLY_MY_DRAFTS],
      status: { in: [BookingStatus.DRAFT] },
    });
  });
});

describe("getBulkBookingsWhereInput: explicit ids", () => {
  it.each(RESTRICTED)(
    "scopes %s even when ids are posted directly",
    async (role) => {
      // Guessing another user's booking id must not be enough: the list never
      // showed it.
      const where = await getBulkBookingsWhereInput({
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
    }
  );

  it.each(UNRESTRICTED)("leaves %s unscoped", async (role) => {
    const where = await getBulkBookingsWhereInput({
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

describe("getBulkBookingsWhereInput: composition", () => {
  it("intersects rather than unions the ownership clause", async () => {
    // A search puts an OR on the list's own clause. A spread-merge would put
    // ownership into that same slot, widening a destructive query instead of
    // narrowing it.
    const where = await getBulkBookingsWhereInput({
      bookingIds: [ALL_SELECTED_KEY],
      list: { kind: "index" },
      organizationId: ORG,
      currentSearchParams: "s=camera",
      access: accessFor([OrganizationRoles.SELF_SERVICE]),
      userId: ME,
    });

    expect(where).toEqual({
      AND: [
        expect.objectContaining({ OR: [expect.anything()] }),
        { OR: [{ creatorId: ME }, { custodianUserId: ME }] },
      ],
    });
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
