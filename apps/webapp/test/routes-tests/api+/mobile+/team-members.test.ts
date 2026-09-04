/**
 * Who the companion's custodian pickers may list.
 *
 * The endpoint feeds four assignment pickers — asset custody, kit custody, the
 * scanner's bulk-assign sheet, and the booking custodian — so it resolves
 * through `resolveCustodianPickerScope` at the `booking-custodian` purpose,
 * the widest of the four. Restricted roles get their own row; ADMIN and OWNER
 * get the roster. The web pickers resolve through the same function, so the
 * two platforms offer the same names for the same caller.
 *
 * @see {@link file://./../../../../app/routes/api+/mobile+/team-members.ts} loader under test
 * @see {@link file://./../../../../app/modules/team-member/service.server.ts} `resolveCustodianPickerScope`
 */

import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLoaderArgs } from "@mocks/remix";

import { db } from "~/database/db.server";
import {
  getMobileUserContext,
  requireMobileAuth,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { loader } from "~/routes/api+/mobile+/team-members";

// @vitest-environment node

vi.mock("~/database/db.server", () => ({
  db: {
    teamMember: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
  },
}));

vi.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vi.fn(),
  requireOrganizationAccess: vi.fn(),
  getMobileUserContext: vi.fn(),
}));

const CALLER = "user-1";

/** The `where` the roster query actually ran with. */
function lastWhere(): any {
  return (db.teamMember.findMany as any).mock.calls.at(-1)?.[0]?.where;
}

function actAs(
  roles: OrganizationRoles[],
  { canSeeAllCustody = false }: { canSeeAllCustody?: boolean } = {}
) {
  (getMobileUserContext as any).mockResolvedValue({
    role: roles[0],
    roles,
    canUseBarcodes: true,
    canUseAudits: true,
    canSeeAllCustody,
  });
}

async function get() {
  return loader(
    createLoaderArgs({
      request: new Request(
        "http://localhost:3000/api/mobile/team-members?orgId=org-1"
      ),
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  (db.teamMember.findMany as any).mockResolvedValue([]);
  (db.teamMember.count as any).mockResolvedValue(0);
  (requireMobileAuth as any).mockResolvedValue({ user: { id: CALLER } });
  (requireOrganizationAccess as any).mockResolvedValue("org-1");
});

describe("GET /api/mobile/team-members — who may be listed", () => {
  it.each([OrganizationRoles.ADMIN, OrganizationRoles.OWNER])(
    "lists the whole roster for %s",
    async (role) => {
      actAs([role], { canSeeAllCustody: true });

      await get();

      expect(lastWhere()).not.toHaveProperty("userId");
    }
  );

  it.each([OrganizationRoles.BASE, OrganizationRoles.SELF_SERVICE])(
    "narrows %s to their own team-member rows",
    async (role) => {
      actAs([role]);

      await get();

      expect(lastWhere()).toMatchObject({
        organizationId: "org-1",
        deletedAt: null,
        userId: CALLER,
      });
    }
  );

  it("keeps BASE narrowed even where the workspace grants custody visibility", async () => {
    // The custody override governs SEEING who holds what. It never widens who
    // a picker may hand something to, so it must not widen this list either.
    actAs([OrganizationRoles.BASE], { canSeeAllCustody: true });

    await get();

    expect(lastWhere()).toMatchObject({ userId: CALLER });
  });

  it("reads the most privileged role, not whichever is stored first", async () => {
    // `roles[0]` would read this membership as SELF_SERVICE and narrow a
    // genuine admin to their own row.
    actAs([OrganizationRoles.SELF_SERVICE, OrganizationRoles.ADMIN]);

    await get();

    expect(lastWhere()).not.toHaveProperty("userId");
  });

  it("still applies the search filter alongside the scope", async () => {
    actAs([OrganizationRoles.BASE]);

    await loader(
      createLoaderArgs({
        request: new Request(
          "http://localhost:3000/api/mobile/team-members?orgId=org-1&search=mario"
        ),
      })
    );

    expect(lastWhere()).toMatchObject({
      userId: CALLER,
      name: { contains: "mario", mode: "insensitive" },
    });
  });
});
