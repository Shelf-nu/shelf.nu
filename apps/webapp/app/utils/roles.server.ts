import type { SsoDetails, OrganizationRoles } from "@prisma/client";
import { Roles } from "@prisma/client";
import * as Sentry from "@sentry/react-router";
import { db } from "~/database/db.server";
import { getSelectedOrganization } from "~/modules/organization/context.server";
import { ShelfError } from "./error";
import type {
  PermissionAction,
  PermissionEntity,
} from "./permissions/permission.data";
import {
  hasPermission,
  validatePermission,
} from "./permissions/permission.validator.server";
import {
  isWorkspaceOwner,
  resolveRole,
  resolveRoleAccess,
} from "./permissions/role-access";
import { SSO_GROUP_ROLE, type SsoGroupField } from "./sso-group-roles";

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

  // The caller's reach: one object every loader and action reads, instead of
  // re-deriving it from the role. Folds this membership's policy with the
  // workspace's visibility toggles.
  const access = resolveRoleAccess({ roles, workspace: currentOrganization });

  // The effective role, for logging and Sentry tags. Decisions read `access`.
  const role: OrganizationRoles = access.role;

  // Determine if user can use barcodes based on organization settings
  const canUseBarcodes = currentOrganization.barcodesEnabled ?? false;

  // Determine if user can use audits based on organization settings
  const canUseAudits = currentOrganization.auditsEnabled ?? false;

  return {
    organizations,
    organizationId,
    currentOrganization,
    role,
    userOrganizations,
    canUseBarcodes,
    canUseAudits,
    access,
  };
}

/**
 * `requirePermission` for a page that opens with ANY of several permissions:
 * a layout whose children are gated separately (Settings, Team).
 *
 * Checks the membership against each permission in order and continues with
 * the first one held, so the result is exactly `requirePermission`'s. Opening
 * such a layout grants nothing by itself: each child keeps its own gate.
 *
 * @param args.userId - The caller
 * @param args.request - The incoming request, used to resolve the caller's memberships
 * @param args.anyOf - Permissions, any of which admits the caller
 * @returns `requirePermission`'s result, plus the membership's roles
 * @throws {ShelfError} 403 when the membership holds none of them
 */
export async function requireAnyPermission({
  userId,
  request,
  anyOf,
}: {
  userId: string;
  request: Request;
  anyOf: ReadonlyArray<{ entity: PermissionEntity; action: PermissionAction }>;
}): Promise<
  Awaited<ReturnType<typeof requirePermission>> & {
    roles: OrganizationRoles[];
  }
> {
  const { organizationId, userOrganizations } = await getSelectedOrganization({
    userId,
    request,
  });
  // An empty array (never `undefined`) so a non-member is refused without the
  // database lookup `hasPermission` falls back to.
  const roles =
    userOrganizations.find((o) => o.organization.id === organizationId)
      ?.roles ?? [];

  let granted: (typeof anyOf)[number] | undefined;
  for (const candidate of anyOf) {
    if (await hasPermission({ organizationId, userId, roles, ...candidate })) {
      granted = candidate;
      break;
    }
  }

  if (!granted) {
    throw new ShelfError({
      cause: null,
      title: "Unauthorized",
      message: "You have no permission to perform this action",
      additionalData: { userId, organizationId, anyOf },
      status: 403,
      label: "Permission",
      shouldBeCaptured: false,
    });
  }

  // `getSelectedOrganization` is cached per request, so the lookup inside
  // `requirePermission` costs nothing more.
  return {
    ...(await requirePermission({ userId, request, ...granted })),
    roles,
  };
}

/**
 * Checks a permission against the organization a route is about, rather than
 * the one the user currently has selected.
 *
 * `requirePermission` judges the caller by their role in the SELECTED
 * workspace, which is right for routes that act on the workspace the user is
 * in. A route that names an organization in its params can act on a different
 * one, and a user's roles differ between workspaces: the owner of the workspace
 * being edited can be a BASE member of the one they are sitting in. Such a route
 * must be judged by the role held in the organization it names.
 *
 * @param userId - The caller
 * @param request - The incoming request, used to resolve the caller's memberships
 * @param organizationId - The organization named by the route, not the selected one
 * @param entity - The entity the route acts on
 * @param action - The action the route performs
 * @returns The caller's memberships and the organizations visible to them
 * @throws {ShelfError} 403 when the caller is not a member of `organizationId`, or
 *   their role there does not grant the permission
 */
export async function requirePermissionInOrganization({
  userId,
  request,
  organizationId,
  entity,
  action,
}: {
  userId: string;
  request: Request;
  organizationId: string;
  entity: PermissionEntity;
  action: PermissionAction;
}) {
  const { organizations, userOrganizations } = await getSelectedOrganization({
    userId,
    request,
  });

  // A non-member holds no roles there, which grants nothing. Passing an empty
  // array rather than `undefined` keeps the check from falling back to a
  // database lookup that would reach the same answer.
  const roles =
    userOrganizations.find((o) => o.organization.id === organizationId)
      ?.roles ?? [];

  await validatePermission({ roles, action, entity, organizationId, userId });

  Sentry.setUser({ id: userId });
  Sentry.setTag("organizationId", organizationId);

  return { organizations, userOrganizations };
}

/**
 * Whether the user owns the given organization: OWNER anywhere in the
 * membership (`isWorkspaceOwner`). The loaders use the same check to decide
 * whether to render the purchase UI, so the server gate and the UI gate cannot
 * disagree.
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
  return isWorkspaceOwner(
    userOrganizations.find((o) => o.organization.id === organizationId)?.roles
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
 * @param field - Raw group-id field (one of `SsoGroupField`)
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
 * claim, using the group ids mapped on `SsoDetails`. When the user's groups
 * match several columns, the highest-rank role wins (`resolveRole`: ADMIN >
 * SELF_SERVICE > BASE). Returns `null` when no configured group matches (the
 * caller then grants no org access, and the user lands on
 * `/sso-pending-assignment`).
 *
 * @param ssoDetails - The org's SSO config (holds the per-role group ids)
 * @param groupIds - The `groups` claim values from the SAML assertion
 * @returns The resolved role, or `null` if none matched
 */
export function getRoleFromGroupId(
  ssoDetails: SsoDetails,
  groupIds: string[]
): OrganizationRoles | null {
  const matched = (Object.keys(SSO_GROUP_ROLE) as SsoGroupField[])
    .filter((field) => groupClaimMatches(ssoDetails[field], groupIds))
    .map((field) => SSO_GROUP_ROLE[field]);

  return matched.length > 0 ? resolveRole(matched) : null;
}
