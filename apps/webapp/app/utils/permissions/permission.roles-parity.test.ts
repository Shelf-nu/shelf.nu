/**
 * Runtime half of the Prisma ↔ `@shelf/permissions` role parity guard.
 *
 * The compile-time assertions in `permission.roles-parity.ts` already catch
 * drift, but they fail with `Type 'true' is not assignable to type 'never'`,
 * which names neither the file nor the role at fault. This test covers the
 * same invariant and fails with the actual diff, so whoever adds a role to the
 * Prisma schema is told exactly what to do.
 *
 * It is also what gives `ORGANIZATION_ROLES` a reason to exist as a runtime
 * value rather than only a type.
 *
 * @see {@link file://./permission.roles-parity.ts}
 * @see {@link file://../../../../../packages/permissions/src/roles.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import { ORGANIZATION_ROLES } from "@shelf/permissions";
import { describe, expect, it } from "vitest";

describe("Prisma ↔ @shelf/permissions role parity", () => {
  it("has exactly the same role names on both sides", () => {
    // Sorted so the assertion is about membership, not declaration order —
    // the package lists roles most-privileged-first, Prisma alphabetically.
    expect([...ORGANIZATION_ROLES].sort()).toEqual(
      Object.values(OrganizationRoles).sort()
    );
  });

  it("keeps the package's role list free of duplicates", () => {
    expect(new Set(ORGANIZATION_ROLES).size).toBe(ORGANIZATION_ROLES.length);
  });
});
