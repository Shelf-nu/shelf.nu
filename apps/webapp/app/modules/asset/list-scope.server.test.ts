/**
 * Pins the asset list scope in both of its forms. The Prisma fragment and the
 * SQL condition must describe the same set (bookable, or in the viewer's
 * custody), and the SQL is a string the compiler cannot check.
 *
 * @see {@link file://./list-scope.server.ts}
 */
import { describe, expect, it } from "vitest";
import { ROLE_POLICIES } from "~/utils/permissions/role-access";
import {
  bookableListScopeSql,
  bookableListScopeWhere,
  resolveBookableListScope,
} from "./list-scope.server";

/** The access shape `resolveBookableListScope` reads, for one role. */
function accessFor(role: keyof typeof ROLE_POLICIES) {
  return { policy: ROLE_POLICIES[role] };
}

describe("resolveBookableListScope", () => {
  it.each(["SELF_SERVICE", "BASE"] as const)(
    "limits %s to bookable assets plus the ones they hold",
    (role) => {
      expect(
        resolveBookableListScope({ access: accessFor(role), userId: "u-1" })
      ).toEqual({ holderUserId: "u-1" });
    }
  );

  it.each(["OWNER", "ADMIN"] as const)("does not limit %s", (role) => {
    expect(
      resolveBookableListScope({ access: accessFor(role), userId: "u-1" })
    ).toBeNull();
  });
});

describe("bookableListScopeWhere", () => {
  it("keeps bookable assets and the ones in the holder's custody", () => {
    expect(bookableListScopeWhere({ holderUserId: "u-1" })).toEqual({
      OR: [
        { availableToBook: true },
        { custody: { some: { custodian: { userId: "u-1" } } } },
      ],
    });
  });
});

describe("bookableListScopeSql", () => {
  it("ORs bookable with a custody row held through one of the user's team members", () => {
    const sql = bookableListScopeSql({ holderUserId: "u-1" });

    expect(sql.sql).toContain(`a."availableToBook" = true OR EXISTS`);
    expect(sql.sql).toContain(`FROM "Custody" scope_cu`);
    expect(sql.sql).toContain(
      `JOIN "TeamMember" scope_tm ON scope_tm.id = scope_cu."teamMemberId"`
    );
    expect(sql.sql).toContain(`scope_cu."assetId" = a.id`);
    expect(sql.sql).toContain(`scope_tm."userId" = ?`);
    // The user id travels as a bound parameter, never spliced into the text.
    expect(sql.values).toEqual(["u-1"]);
  });
});
