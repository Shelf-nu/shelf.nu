/**
 * Permission regression tests for the mobile dashboard endpoint.
 *
 * `GET /api/mobile/dashboard` gates with `requireOrganizationAccess`, which
 * proves org MEMBERSHIP but performs no role check. Its three `getBookings`
 * calls (upcoming / active / overdue) must therefore carry their own custodian
 * restriction, or a SELF_SERVICE / BASE member receives every booking in the
 * workspace with custodian names attached.
 *
 * The mobile bookings list already draws this line (`bookings.ts:77-85` scopes
 * self-service/base to `custodianUserId: user.id`); these tests pin the
 * dashboard to the same contract so the two mobile surfaces agree.
 *
 * They assert on the `where` handed to `db.booking.findMany` rather than on
 * query results, because the `where` *is* the security boundary — and because
 * running the real `getBookings` proves the restriction survives composition
 * into the query, not merely that a parameter was passed. (`getBookings` ANDs
 * `custodianScope` in as one clause; a param-level assertion against a mocked
 * service would not prove it lands.)
 *
 * @see {@link file://./dashboard.ts} for the loader under test
 * @see {@link file://./../../../modules/booking/service.server.ts} — `getBookings`
 * @see {@link file://./../../../modules/booking/service.server.get-bookings-permissions.test.ts}
 */

import { OrganizationRoles } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLoaderArgs } from "@mocks/remix";

import { db } from "~/database/db.server";
import type * as MobileAuthServer from "~/modules/api/mobile-auth.server";
import {
  getMobileUserContext,
  requireMobileAuth,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";

import { loader } from "./dashboard";

// @vitest-environment node

// why: the dashboard runs the REAL `getBookings`, whose `where` is the subject
// under test. Mocking the Prisma client is what lets us capture that argument;
// every model the loader touches in its `Promise.all` needs a stub or the
// loader throws before reaching the assertion.
vi.mock("~/database/db.server", () => ({
  db: {
    booking: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    asset: {
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
      findMany: vi.fn().mockResolvedValue([]),
    },
    category: { count: vi.fn().mockResolvedValue(0) },
    location: { count: vi.fn().mockResolvedValue(0) },
    teamMember: { count: vi.fn().mockResolvedValue(0) },
    auditSession: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

// why: JWT validation and org-membership resolution are out of scope here —
// stub them to a fixed user + org so the loader runs. `getMobileUserContext`
// is stubbed per-test because the CALLER'S ROLE is the variable under test.
// The remaining exports stay real (`vi.importActual`) so nothing else is
// silently replaced.
vi.mock("~/modules/api/mobile-auth.server", async () => {
  const actual = await vi.importActual<typeof MobileAuthServer>(
    "~/modules/api/mobile-auth.server"
  );
  return {
    ...actual,
    requireMobileAuth: vi.fn(),
    requireOrganizationAccess: vi.fn(),
    getMobileUserContext: vi.fn(),
  };
});

const findManyMock = vi.mocked(db.booking.findMany);
const requireMobileAuthMock = vi.mocked(requireMobileAuth);
const requireOrganizationAccessMock = vi.mocked(requireOrganizationAccess);
const getMobileUserContextMock = vi.mocked(getMobileUserContext);

/** The caller these tests act as. */
const CALLER_USER_ID = "caller-user-1";
const ORG_ID = "org-1";

/**
 * Points the stubbed mobile-auth helpers at a caller holding `role`.
 *
 * @param role - The caller's role in `ORG_ID`
 */
function actAs(role: OrganizationRoles) {
  requireMobileAuthMock.mockResolvedValue({
    user: {
      id: CALLER_USER_ID,
      email: "caller@example.com",
      firstName: "Caller",
      lastName: "User",
      profilePicture: null,
      onboarded: true,
    },
  } as unknown as Awaited<ReturnType<typeof requireMobileAuth>>);
  requireOrganizationAccessMock.mockResolvedValue(ORG_ID);
  getMobileUserContextMock.mockResolvedValue({
    role,
    canUseBarcodes: true,
    canUseAudits: true,
    canSeeAllCustody: role !== OrganizationRoles.SELF_SERVICE,
  });
}

/**
 * Runs the dashboard loader and returns every `where` it handed to
 * `db.booking.findMany` — one per booking section (upcoming/active/overdue).
 *
 * @returns The captured `where` clauses, in call order
 */
async function captureBookingWheres(): Promise<Prisma.BookingWhereInput[]> {
  await loader(
    createLoaderArgs({
      request: new Request(
        `http://localhost:3000/api/mobile/dashboard?orgId=${ORG_ID}`
      ),
    })
  );

  return findManyMock.mock.calls.map(
    (call) => (call[0] as { where: Prisma.BookingWhereInput }).where
  );
}

/**
 * Normalises `Prisma.BookingWhereInput["AND"]` (typed `T | T[]`) to an array.
 *
 * @param where - The captured where clause
 * @returns The `AND` clauses as an array
 */
function andClausesOf(
  where: Prisma.BookingWhereInput
): Prisma.BookingWhereInput[] {
  const and = where.AND;
  if (!and) return [];
  return Array.isArray(and) ? and : [and];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/mobile/dashboard — booking visibility", () => {
  it.each([OrganizationRoles.SELF_SERVICE, OrganizationRoles.BASE])(
    "restricts every booking section to the caller's own bookings for %s",
    async (role) => {
      actAs(role);

      const wheres = await captureBookingWheres();

      // Upcoming (RESERVED), active (ONGOING) and overdue — all three must be
      // restricted. A partial fix that scopes only some sections still leaks.
      expect(wheres).toHaveLength(3);

      for (const where of wheres) {
        expect(andClausesOf(where)).toContainEqual({
          custodianUserId: CALLER_USER_ID,
        });
      }
    }
  );

  it.each([OrganizationRoles.ADMIN, OrganizationRoles.OWNER])(
    "does not restrict booking sections for %s",
    async (role) => {
      actAs(role);

      const wheres = await captureBookingWheres();

      expect(wheres).toHaveLength(3);

      // Guards the opposite failure: over-restricting privileged roles would
      // silently empty the dashboard admins and owners rely on.
      for (const where of wheres) {
        expect(andClausesOf(where)).not.toContainEqual({
          custodianUserId: CALLER_USER_ID,
        });
      }
    }
  );
});
