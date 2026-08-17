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

import { ALL_SELECTED_KEY } from "~/utils/list";
import {
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
    expect(getBookingOwnershipScope({ role, userId: ME })).toBeNull();
  });

  it.each(RESTRICTED)("restricts %s to their own bookings", (role) => {
    expect(getBookingOwnershipScope({ role, userId: ME })).toEqual({
      OR: [{ creatorId: ME }, { custodianUserId: ME }],
    });
  });

  it("fails closed when a restricted role has no user to scope to", () => {
    // Returning null here would silently widen to the whole workspace
    expect(() =>
      getBookingOwnershipScope({ role: OrganizationRoles.BASE })
    ).toThrow();
  });

  it("restricts an unrecognised role rather than waving it through", () => {
    // The check allow-lists ADMIN/OWNER, so a role added to the enum later
    // lands in the RESTRICTED branch by default. A deny-list would hand it
    // org-wide delete on the day it was introduced.
    const futureRole = "AUDITOR" as OrganizationRoles;

    expect(getBookingOwnershipScope({ role: futureRole, userId: ME })).toEqual({
      OR: [{ creatorId: ME }, { custodianUserId: ME }],
    });
  });

  it("covers every role in the enum, so a new one cannot slip past unreviewed", () => {
    // Fails the moment `OrganizationRoles` grows a member: whoever adds it has
    // to decide which side of this clause it belongs on.
    expect(Object.values(OrganizationRoles).sort()).toEqual([
      OrganizationRoles.ADMIN,
      OrganizationRoles.BASE,
      OrganizationRoles.OWNER,
      OrganizationRoles.SELF_SERVICE,
    ]);
  });
});

describe("getBulkBookingsWhereInput — select all", () => {
  it.each(RESTRICTED)("scopes %s to their own bookings", (role) => {
    const where = getBulkBookingsWhereInput({
      bookingIds: [ALL_SELECTED_KEY],
      organizationId: ORG,
      currentSearchParams: "status=DRAFT",
      role,
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
      role,
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
      role,
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
      role,
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
      role: OrganizationRoles.SELF_SERVICE,
      userId: ME,
    });

    expect(Array.isArray(where.AND)).toBe(true);
    expect(where.OR).toBeUndefined();
  });
});
