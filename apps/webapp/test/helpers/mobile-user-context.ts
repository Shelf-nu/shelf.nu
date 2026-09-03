import { OrganizationRoles } from "@prisma/client";
import {
  isSelfServiceOrBaseRole,
  resolveMostPrivilegedRole,
} from "~/utils/booking-authorization.server";

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
 */
export function mobileUserContext(
  overrides: {
    roles?: OrganizationRoles[];
    canUseBarcodes?: boolean;
    canUseAudits?: boolean;
    canSeeAllCustody?: boolean;
    canSeeAllBookings?: boolean;
  } = {}
) {
  const roles = overrides.roles ?? [OrganizationRoles.ADMIN];
  const effectiveRole = resolveMostPrivilegedRole(roles);
  const restricted = isSelfServiceOrBaseRole(effectiveRole);

  return {
    role: roles[0] ?? OrganizationRoles.BASE,
    roles,
    effectiveRole,
    isSelfServiceOrBase: restricted,
    canUseBarcodes: overrides.canUseBarcodes ?? true,
    canUseAudits: overrides.canUseAudits ?? true,
    canSeeAllCustody: overrides.canSeeAllCustody ?? !restricted,
    canSeeAllBookings: overrides.canSeeAllBookings ?? !restricted,
  };
}
