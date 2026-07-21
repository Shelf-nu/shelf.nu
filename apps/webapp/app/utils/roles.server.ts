import type { SsoDetails } from "@prisma/client";
import { OrganizationRoles, Roles } from "@prisma/client";
import * as Sentry from "@sentry/react-router";
import { db } from "~/database/db.server";
import { getSelectedOrganization } from "~/modules/organization/context.server";
import { ShelfError } from "./error";
import type {
  PermissionAction,
  PermissionEntity,
} from "./permissions/permission.data";
import { validatePermission } from "./permissions/permission.validator.server";

export async function requireUserWithPermission(name: Roles, userId: string) {
  try {
    return await db.user.findFirstOrThrow({
      where: { id: userId, roles: { some: { name } } },
      select: { id: true },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "You do not have permission to access this resource",
      additionalData: { userId, name },
      label: "Permission",
      status: 403,
      shouldBeCaptured: false,
    });
  }
}

export async function requireAdmin(userId: string) {
  return requireUserWithPermission(Roles["ADMIN"], userId);
}

export async function isAdmin(context: Record<string, any>) {
  const authSession = context.getSession();

  const user = await db.user.findFirst({
    where: {
      id: authSession.userId,
      roles: { some: { name: Roles["ADMIN"] } },
    },
    select: { id: true },
  });

  return !!user;
}

export async function requirePermission({
  userId,
  request,
  entity,
  action,
}: {
  userId: string;
  request: Request;
  entity: PermissionEntity;
  action: PermissionAction;
}) {
  /**
   * This can be very slow and consuming as there are a few queries with a few joins and this running on every loader/action makes it slow
   * We need to find a  strategy to make it more performant. Idea:
   * 1. Have a very light weight query that fetches the lastUpdated in relation to userOrganizationRoles. THis can be done both for roles and organizations
   * 2. Store it in a cookie
   * 3. If they mismatch, make the big query to check the actual data
   */

  const {
    organizationId,
    userOrganizations,
    organizations,
    currentOrganization,
  } = await getSelectedOrganization({ userId, request });

  const roles = userOrganizations.find(
    (o) => o.organization.id === organizationId
  )?.roles;

  await validatePermission({
    roles,
    action,
    entity,
    organizationId,
    userId,
  });

  // Tag the current Sentry scope with the resolved user + organization so
  // every span / error emitted later in this request is filterable in
  // Sentry by `user.id` and `organizationId`. requirePermission runs in
  // every authenticated loader/action, so this is the natural choke point.
  Sentry.setUser({ id: userId });
  Sentry.setTag("organizationId", organizationId);

  const role = roles ? roles[0] : OrganizationRoles.BASE;

  const isSelfServiceOrBase =
    role === OrganizationRoles.SELF_SERVICE || role === OrganizationRoles.BASE;

  /**
   * This checks the organization settings permissions overrides for BASE and SELF_SERVICE roles
   * If the user is in a BASE or SELF_SERVICE role, we check if they can see all bookings
   */
  const canSeeAllBookings =
    // Admin/Owner always can see all
    !isSelfServiceOrBase ||
    // SELF_SERVICE can see all if org setting allows
    (role === OrganizationRoles.SELF_SERVICE &&
      currentOrganization.selfServiceCanSeeBookings) ||
    // BASE can see all if org setting allows
    (role === OrganizationRoles.BASE &&
      currentOrganization.baseUserCanSeeBookings);

  // Determine if user can see all custody information
  const canSeeAllCustody =
    // Admin/Owner always can see all
    !isSelfServiceOrBase ||
    // SELF_SERVICE can see all if org setting allows
    (role === OrganizationRoles.SELF_SERVICE &&
      currentOrganization.selfServiceCanSeeCustody) ||
    // BASE can see all if org setting allows
    (role === OrganizationRoles.BASE &&
      currentOrganization.baseUserCanSeeCustody);

  // Determine if user can use barcodes based on organization settings
  const canUseBarcodes = currentOrganization.barcodesEnabled ?? false;

  // Determine if user can use audits based on organization settings
  const canUseAudits = currentOrganization.auditsEnabled ?? false;

  return {
    organizations,
    organizationId,
    currentOrganization,
    role,
    isSelfServiceOrBase,
    userOrganizations,
    canSeeAllBookings,
    canSeeAllCustody,
    canUseBarcodes,
    canUseAudits,
  };
}

/**
 * Splits a comma-separated `SsoDetails` group-id field into a normalized list of
 * lower-cased, trimmed, non-empty ids. Mirrors the comma-separated convention
 * already used by `SsoDetails.domain`, so one role can map to several IdP groups
 * without a schema change.
 *
 * @param field - Raw group-id field (`adminGroupId` | `selfServiceGroupId` | `baseUserGroupId`)
 * @returns Normalized group ids (possibly empty)
 */
function parseGroupIds(field: string | null | undefined): string[] {
  return (field ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Returns true if the group id(s) configured on a role field are present in the
 * SAML `groups` claim. Matching is trimmed + case-insensitive.
 *
 * Two match modes, checked in order, so both real-world value shapes work:
 *  1. Whole-field match — the entire trimmed field equals a claim value. Supports
 *     values that themselves contain commas, e.g. LDAP DNs like
 *     `cn=shelf-base,ou=groups,dc=example,dc=edu`.
 *  2. Comma-separated list — the field is split on commas and any token matches.
 *     Supports mapping several comma-free groups (names, Grouper paths, entitlement
 *     URIs, scoped affiliations) to one role.
 *
 * A field containing `=` is treated as a single DN-style value (whole-field only),
 * NOT split on commas — otherwise a DN's components (`dc=edu`, `ou=groups`) would
 * each become match candidates and could falsely grant a role. Consequence: you
 * cannot comma-list multiple DN values in one field (map them to separate roles,
 * or use comma-free identifiers).
 *
 * @param field - The role's configured group-id field on `SsoDetails`
 * @param claimGroups - The `groups` claim values from the SAML assertion
 */
function groupClaimMatches(
  field: string | null | undefined,
  claimGroups: string[]
): boolean {
  const whole = (field ?? "").trim().toLowerCase();
  if (!whole) return false;
  const claims = claimGroups.map((value) => value.trim().toLowerCase());
  // 1. Whole-field exact match (handles comma-bearing values like LDAP DNs).
  if (claims.includes(whole)) return true;
  // 2. A DN-style value (contains "=") is a single value only — never split it,
  //    so its components can't become false matches.
  if (whole.includes("=")) return false;
  // 3. Otherwise treat the field as a comma-separated list of individual group ids.
  return parseGroupIds(field).some((id) => claims.includes(id));
}

/**
 * Resolves the Shelf organization role for an SSO user from the SAML `groups`
 * claim, using the group ids mapped on `SsoDetails`. Precedence is
 * ADMIN > SELF_SERVICE > BASE: if the user is in groups for multiple roles, the
 * highest wins. Returns `null` when no configured group matches (the caller then
 * grants no org access → the user lands on `/sso-pending-assignment`).
 *
 * @param ssoDetails - The org's SSO config (holds the per-role group ids)
 * @param groupIds - The `groups` claim values from the SAML assertion
 * @returns The resolved role, or `null` if none matched
 */
export function getRoleFromGroupId(
  ssoDetails: SsoDetails,
  groupIds: string[]
): OrganizationRoles | null {
  // We prioritize the admin group. If the user is in several, the highest role wins.
  if (groupClaimMatches(ssoDetails.adminGroupId, groupIds)) {
    return OrganizationRoles.ADMIN;
  } else if (groupClaimMatches(ssoDetails.selfServiceGroupId, groupIds)) {
    return OrganizationRoles.SELF_SERVICE;
  } else if (groupClaimMatches(ssoDetails.baseUserGroupId, groupIds)) {
    return OrganizationRoles.BASE;
  } else {
    return null;
  }
}
