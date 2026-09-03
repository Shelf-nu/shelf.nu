/**
 * `getMobileUserContext` is the one place the mobile API learns what a caller
 * may see. Every booking read surface on the phone — the list, the calendar,
 * the booking detail, the Home tab — takes its answer from here.
 *
 * It has to select all four organization overrides. The two custody columns
 * decide whether a custodian may be named; the two booking columns decide
 * which bookings exist for the caller at all. A column missing from that
 * select cannot be honoured by any endpoint downstream, however correct their
 * own gates are.
 *
 * @see {@link file://./mobile-auth.server.ts} `getMobileUserContext`
 * @see {@link file://./../../utils/booking-authorization.server.ts} `resolveCanSeeAllBookings`
 */

import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import { getMobileUserContext } from "~/modules/api/mobile-auth.server";

// why: the module instantiates a real Prisma client at load and would try to
// connect; `pnpm test:run` has no database. Only the one query this function
// makes needs to exist.
vi.mock("~/database/db.server", () => ({
  db: { userOrganization: { findUnique: vi.fn() } },
}));

// why: `requireMobileAuth` validates the Bearer JWT against Supabase Admin at
// module scope. Irrelevant here, and there is no service to reach.
vi.mock("~/integrations/supabase/client", () => ({
  getSupabaseAdmin: vi.fn(),
}));

// why: fire-and-forget usage recorder that would touch the mocked db.
vi.mock("./mobile-usage.server", () => ({
  recordMobileActivity: vi.fn(),
}));

const findUnique = vi.mocked(db.userOrganization.findUnique);

/** Seeds the single membership row `getMobileUserContext` reads. */
function membership(
  roles: OrganizationRoles[],
  org: Partial<{
    selfServiceCanSeeBookings: boolean;
    baseUserCanSeeBookings: boolean;
    selfServiceCanSeeCustody: boolean;
    baseUserCanSeeCustody: boolean;
  }> = {}
) {
  findUnique.mockResolvedValue({
    roles,
    organization: {
      barcodesEnabled: false,
      auditsEnabled: false,
      selfServiceCanSeeCustody: false,
      baseUserCanSeeCustody: false,
      selfServiceCanSeeBookings: false,
      baseUserCanSeeBookings: false,
      ...org,
    },
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getMobileUserContext — booking visibility", () => {
  it("selects the two booking overrides, not just the custody pair", async () => {
    membership([OrganizationRoles.BASE]);

    await getMobileUserContext("user-1", "org-1");

    const select = (findUnique.mock.calls[0]?.[0] as any).select.organization
      .select;
    expect(select).toMatchObject({
      selfServiceCanSeeBookings: true,
      baseUserCanSeeBookings: true,
      selfServiceCanSeeCustody: true,
      baseUserCanSeeCustody: true,
    });
  });

  it.each([OrganizationRoles.ADMIN, OrganizationRoles.OWNER])(
    "lets %s see every booking regardless of the overrides",
    async (role) => {
      membership([role]);

      const ctx = await getMobileUserContext("user-1", "org-1");

      expect(ctx.canSeeAllBookings).toBe(true);
      expect(ctx.isSelfServiceOrBase).toBe(false);
    }
  );

  it.each([OrganizationRoles.BASE, OrganizationRoles.SELF_SERVICE])(
    "restricts %s while the matching override is off",
    async (role) => {
      membership([role]);

      const ctx = await getMobileUserContext("user-1", "org-1");

      expect(ctx.canSeeAllBookings).toBe(false);
      expect(ctx.isSelfServiceOrBase).toBe(true);
    }
  );

  it("frees a BASE user when baseUserCanSeeBookings is on", async () => {
    membership([OrganizationRoles.BASE], { baseUserCanSeeBookings: true });

    const ctx = await getMobileUserContext("user-1", "org-1");

    expect(ctx.canSeeAllBookings).toBe(true);
  });

  it("frees a SELF_SERVICE user when selfServiceCanSeeBookings is on", async () => {
    membership([OrganizationRoles.SELF_SERVICE], {
      selfServiceCanSeeBookings: true,
    });

    const ctx = await getMobileUserContext("user-1", "org-1");

    expect(ctx.canSeeAllBookings).toBe(true);
  });

  it("reads the override matching the ROLE, not either one", async () => {
    // The two flags are independent. A workspace that freed self-service users
    // has said nothing about base users.
    membership([OrganizationRoles.BASE], { selfServiceCanSeeBookings: true });

    const ctx = await getMobileUserContext("user-1", "org-1");

    expect(ctx.canSeeAllBookings).toBe(false);
  });

  it("keeps booking and custody visibility independent", async () => {
    membership([OrganizationRoles.BASE], { baseUserCanSeeBookings: true });

    const ctx = await getMobileUserContext("user-1", "org-1");

    // Seeing a colleague's booking does not mean seeing who holds it.
    expect(ctx.canSeeAllBookings).toBe(true);
    expect(ctx.canSeeAllCustody).toBe(false);
  });

  it("resolves the most privileged role, not whichever is stored first", async () => {
    // `role` is roles[0] and is wrong for any gate: an admin whose membership
    // happens to start with SELF_SERVICE would be treated as restricted.
    membership([OrganizationRoles.SELF_SERVICE, OrganizationRoles.ADMIN]);

    const ctx = await getMobileUserContext("user-1", "org-1");

    expect(ctx.effectiveRole).toBe(OrganizationRoles.ADMIN);
    expect(ctx.canSeeAllBookings).toBe(true);
    expect(ctx.canSeeAllCustody).toBe(true);
    expect(ctx.isSelfServiceOrBase).toBe(false);
    // The legacy field is deliberately left alone; callers still read it.
    expect(ctx.role).toBe(OrganizationRoles.SELF_SERVICE);
  });
});
