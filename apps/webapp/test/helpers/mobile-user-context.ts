/**
 * Builds a `getMobileUserContext` return value for route tests.
 *
 * Route tests mock that function, so every field a route reads must be present
 * on the mock or the route silently sees `undefined`. Build the shape here
 * rather than hand-writing `{ roles: [...] }` literals per test: a permission
 * field that is absent reads as `false`, which quietly inverts an assertion
 * instead of failing it.
 *
 * The visibility flags default to what the role alone implies, which is the
 * behaviour with both workspace overrides OFF. A test that cares about an
 * override passes it explicitly:
 *
 *     mobileUserContext({ roles: ["BASE"], canSeeAllBookings: true })
 *
 * `access` is folded from the SAME toggles `canSeeAllBookings` /
 * `canSeeAllCustody` resolve to (each switches both the `selfService` and
 * `baseUser` pair of its axis on), so the shorthand flags and `access` can
 * never disagree. A test that needs one axis widened without the other, or a
 * SELF_SERVICE-only / BASE-only toggle, passes `workspace` directly: it is
 * merged in last and wins over the shorthand:
 *
 *     mobileUserContext({ roles: ["BASE"], workspace: { baseUserCanSeeCustody: true } })
 */

import { OrganizationRoles } from "@prisma/client";
import {
  isSelfServiceOrBaseRole,
  resolveMostPrivilegedRole,
} from "~/utils/booking-authorization.server";
import type { WorkspaceAccessSettings } from "~/utils/permissions/role-access";
import { resolveRoleAccess } from "~/utils/permissions/role-access";
import { ALL_TOGGLES_OFF } from "./role-access";

export function mobileUserContext(
  overrides: {
    roles?: OrganizationRoles[];
    canUseBarcodes?: boolean;
    canUseAudits?: boolean;
    canSeeAllCustody?: boolean;
    canSeeAllBookings?: boolean;
    /** Toggles to switch on; `canSeeAll*: true` switches the matching pair on. */
    workspace?: Partial<WorkspaceAccessSettings>;
  } = {}
) {
  const roles = overrides.roles ?? [OrganizationRoles.ADMIN];
  const effectiveRole = resolveMostPrivilegedRole(roles);
  const restricted = isSelfServiceOrBaseRole(effectiveRole);
  const workspace: WorkspaceAccessSettings = {
    ...ALL_TOGGLES_OFF,
    ...(overrides.canSeeAllBookings
      ? { selfServiceCanSeeBookings: true, baseUserCanSeeBookings: true }
      : {}),
    ...(overrides.canSeeAllCustody
      ? { selfServiceCanSeeCustody: true, baseUserCanSeeCustody: true }
      : {}),
    ...overrides.workspace,
  };
  const access = resolveRoleAccess({ roles, workspace });

  return {
    role: roles[0] ?? OrganizationRoles.BASE,
    roles,
    effectiveRole,
    isSelfServiceOrBase: restricted,
    canUseBarcodes: overrides.canUseBarcodes ?? true,
    canUseAudits: overrides.canUseAudits ?? true,
    canSeeAllCustody: overrides.canSeeAllCustody ?? access.custody.seeAll,
    canSeeAllBookings: overrides.canSeeAllBookings ?? access.bookings.seeAll,
    access,
  };
}
