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
import { SSO_ASSIGNABLE_ROLE_PRECEDENCE } from "./role-precedence";

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

/**
 * The caller's effective role in one organization.
 *
 * A membership's `roles` is an array, but the app treats the **first** entry as
 * authoritative everywhere a single role is needed. Exported so callers outside
 * {@link requirePermission} (e.g. `/api/model-filters`) resolve the role the
 * exact same way — a different rule here would make a search disagree with the
 * loader that seeded it.
 *
 * @param args.userOrganizations - Memberships from `getSelectedOrganization`.
 * @param args.organizationId - Workspace whose membership to read.
 * @returns The effective role, defaulting to `BASE` when no membership matches.
 */
export function resolveEffectiveRole({
  userOrganizations,
  organizationId,
}: {
  userOrganizations: Array<{
    organization: { id: string };
    roles: OrganizationRoles[];
  }>;
  organizationId: string;
}): OrganizationRoles {
  const roles = userOrganizations.find(
    (o) => o.organization.id === organizationId
  )?.roles;

  return roles?.[0] ?? OrganizationRoles.BASE;
}

/**
 * Whether a role is one of the two restricted, "own records only" roles.
 *
 * @param role - Effective role from {@link resolveEffectiveRole}.
 * @returns `true` for SELF_SERVICE and BASE.
 */
export function isSelfServiceOrBaseRole(role: OrganizationRoles): boolean {
  return (
    role === OrganizationRoles.SELF_SERVICE || role === OrganizationRoles.BASE
  );
}

/**
 * Whether the caller may see bookings they are not the custodian of.
 *
 * ADMIN / OWNER always can. SELF_SERVICE and BASE only can when the workspace
 * has switched the corresponding setting on. This is the standard visibility
 * rule for bookings; every read path that can surface someone else's booking
 * gates on it (`/bookings`, the command palette, CSV export).
 *
 * Exported so callers outside {@link requirePermission} resolve it identically.
 * A surface that invents its own rule ends up disagreeing with the loader that
 * seeded it, which is how a picker's list changes the moment a user types.
 *
 * @param args.role - Effective role from {@link resolveEffectiveRole}.
 * @param args.currentOrganization - Workspace whose override settings apply.
 * @returns `true` when bookings should NOT be restricted to the caller's own.
 */
export function resolveCanSeeAllBookings({
  role,
  currentOrganization,
}: {
  role: OrganizationRoles;
  currentOrganization: {
    selfServiceCanSeeBookings: boolean;
    baseUserCanSeeBookings: boolean;
  };
}): boolean {
  return (
    // Admin/Owner always can see all
    !isSelfServiceOrBaseRole(role) ||
    // SELF_SERVICE can see all if org setting allows
    (role === OrganizationRoles.SELF_SERVICE &&
      currentOrganization.selfServiceCanSeeBookings) ||
    // BASE can see all if org setting allows
    (role === OrganizationRoles.BASE &&
      currentOrganization.baseUserCanSeeBookings)
  );
}

/**
 * Whether the caller may see custody information for people other than
 * themselves.
 *
 * ADMIN / OWNER always can. SELF_SERVICE and BASE only when the workspace has
 * switched their respective override on. Exported so callers outside
 * {@link requirePermission} — notably `/api/model-filters` — resolve it
 * identically; a surface that invents its own rule ends up disagreeing with
 * the loader that seeded it.
 *
 * This governs VIEWING only. It never grants the right to assign custody:
 * SELF_SERVICE may assign only to themselves and BASE may not assign at all,
 * regardless of this flag. See `resolveCustodianPickerScope`.
 *
 * @param args.role - Effective role from {@link resolveEffectiveRole}.
 * @param args.currentOrganization - Workspace whose override settings apply.
 * @returns `true` when custody reads should NOT be restricted to the caller.
 */
export function resolveCanSeeAllCustody({
  role,
  currentOrganization,
}: {
  role: OrganizationRoles;
  currentOrganization: {
    selfServiceCanSeeCustody: boolean;
    baseUserCanSeeCustody: boolean;
  };
}): boolean {
  return (
    // Admin/Owner always can see all
    !isSelfServiceOrBaseRole(role) ||
    // SELF_SERVICE can see all if org setting allows
    (role === OrganizationRoles.SELF_SERVICE &&
      currentOrganization.selfServiceCanSeeCustody) ||
    // BASE can see all if org setting allows
    (role === OrganizationRoles.BASE &&
      currentOrganization.baseUserCanSeeCustody)
  );
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

  const role = resolveEffectiveRole({ userOrganizations, organizationId });

  const isSelfServiceOrBase = isSelfServiceOrBaseRole(role);

  /**
   * This checks the organization settings permissions overrides for BASE and SELF_SERVICE roles
   * If the user is in a BASE or SELF_SERVICE role, we check if they can see all bookings
   */
  const canSeeAllBookings = resolveCanSeeAllBookings({
    role,
    currentOrganization,
  });

  // Determine if user can see all custody information
  const canSeeAllCustody = resolveCanSeeAllCustody({
    role,
    currentOrganization,
  });

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
 * Whether the user holds OWNER in the given organization.
 *
 * Checks membership of the roles ARRAY rather than `resolveEffectiveRole`,
 * which returns `roles[0]` — a user carrying more than one role could be the
 * owner without OWNER being first. This mirrors the check the loaders already
 * use to decide whether to render the purchase UI, so the server gate and the
 * UI gate cannot disagree.
 *
 * @param userOrganizations - The caller's memberships, as returned by `requirePermission`
 * @param organizationId - The active organization
 * @returns `true` if the caller owns this workspace
 */
export function isOrganizationOwner({
  userOrganizations,
  organizationId,
}: {
  userOrganizations: Array<{
    organization: { id: string };
    roles: OrganizationRoles[];
  }>;
  organizationId: string;
}): boolean {
  return (
    userOrganizations
      .find((o) => o.organization.id === organizationId)
      ?.roles.includes(OrganizationRoles.OWNER) ?? false
  );
}

/**
 * Asserts the caller owns the workspace.
 *
 * `requirePermission(subscription, update)` is NOT sufficient for anything that
 * spends money or burns a one-time entitlement: ADMIN short-circuits to
 * allow-all in `hasPermission`, so it passes that gate. The add-on purchase UI
 * is owner-only, but the actions behind it were not — letting an ADMIN burn the
 * workspace's single free trial (an irreversible flag) and commit the workspace
 * to a charge on the owner's card.
 *
 * @param userOrganizations - The caller's memberships, as returned by `requirePermission`
 * @param organizationId - The active organization
 * @param action - Verb phrase completing "Only the workspace owner can …"
 * @throws {ShelfError} 403 if the caller is not the owner
 */
export function assertIsOrganizationOwner({
  userOrganizations,
  organizationId,
  action,
}: {
  userOrganizations: Array<{
    organization: { id: string };
    roles: OrganizationRoles[];
  }>;
  organizationId: string;
  action: string;
}): void {
  if (!isOrganizationOwner({ userOrganizations, organizationId })) {
    throw new ShelfError({
      cause: null,
      title: "Owner only",
      message: `Only the workspace owner can ${action}.`,
      additionalData: { organizationId },
      label: "Subscription",
      status: 403,
      shouldBeCaptured: false,
    });
  }
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
  // Which SsoDetails field configures the group for each role.
  const groupField: Record<
    (typeof SSO_ASSIGNABLE_ROLE_PRECEDENCE)[number],
    string | null
  > = {
    [OrganizationRoles.ADMIN]: ssoDetails.adminGroupId,
    [OrganizationRoles.SELF_SERVICE]: ssoDetails.selfServiceGroupId,
    [OrganizationRoles.BASE]: ssoDetails.baseUserGroupId,
  };

  // Walk in precedence order so the highest matching role wins. The order is
  // shared with the booking ownership guard (see role-precedence.ts) rather
  // than restated here, so the two cannot drift.
  return (
    SSO_ASSIGNABLE_ROLE_PRECEDENCE.find((role) =>
      groupClaimMatches(groupField[role], groupIds)
    ) ?? null
  );
}
