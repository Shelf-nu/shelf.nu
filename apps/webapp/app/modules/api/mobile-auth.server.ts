import { Roles } from "@prisma/client";
import type {
  AssetType,
  ConsumptionType,
  Organization,
  OrganizationRoles,
} from "@prisma/client";
import { db } from "~/database/db.server";
import { getSupabaseAdmin } from "~/integrations/supabase/client";
import {
  serializeAssetImage,
  type AssetImageSource,
} from "~/modules/asset/image-resolution";
import { ASSET_MODEL_IMAGE_SELECT } from "~/modules/asset/image-select";
import {
  ASSET_IMAGE_RESIGN_LIMITS,
  refreshExpiredAssetImages,
} from "~/modules/asset/service.server";
import { revokeAllSessions } from "~/modules/auth/service.server";
import {
  createSsoRequiredError,
  getLegacyLoginDecisionForUser,
} from "~/modules/auth/sso-enforcement.server";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import {
  type PermissionAction,
  type PermissionEntity,
} from "~/utils/permissions/permission.data";
import { validatePermission } from "~/utils/permissions/permission.validator.server";
import type { RoleAccess } from "~/utils/permissions/role-access";
import { resolveRoleAccess } from "~/utils/permissions/role-access";
import { disabledTeamOrg } from "~/utils/stripe.server";
import {
  assertCanUseBookings,
  canUseAudits,
  canUseBarcodes,
} from "~/utils/subscription.server";
import { scopeMobileAssetCustodyToViewer } from "./mobile-custody-visibility.server";
import { recordMobileActivity } from "./mobile-usage.server";

/**
 * Validates a Supabase JWT from the Authorization header and returns the
 * authenticated user's database record.
 *
 * Used exclusively by mobile API routes. The webapp's cookie-based session
 * middleware doesn't apply to mobile clients, so we validate the JWT directly.
 */
export async function requireMobileAuth(request: Request) {
  const authHeader = request.headers.get("Authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    throw new ShelfError({
      cause: null,
      message: "Missing or invalid Authorization header",
      label: "Auth",
      status: 401,
    });
  }

  const token = authHeader.slice(7);

  // Validate the JWT with Supabase Admin
  const {
    data: { user: authUser },
    error,
  } = await getSupabaseAdmin().auth.getUser(token);

  if (error || !authUser) {
    throw new ShelfError({
      cause: error,
      message: "Invalid or expired token",
      label: "Auth",
      status: 401,
    });
  }

  if (!authUser.email) {
    throw new ShelfError({
      cause: null,
      message: "User account has no email address",
      label: "Auth",
      status: 400,
    });
  }

  // The Shelf user shares its id with the auth user, so the verified token's
  // subject identifies the account. Never resolve by email: a separate auth
  // user can hold the same address (a non-SSO account beside an SSO one), and
  // its session must not act as the Shelf account.
  const user = await db.user.findUnique({
    where: { id: authUser.id },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      displayName: true,
      profilePicture: true,
      onboarded: true,
      // Date/time format preferences (raw, nullable). Surfaced on
      // `/api/mobile/me` so the companion renders every date/time in the user's
      // chosen format + timezone instead of device-local. Resolved client-side
      // via `resolveFormatPrefs` (@shelf/datetime) with a device-hint fallback.
      dateFormat: true,
      timeFormat: true,
      weekStart: true,
      timeZone: true,
      deletedAt: true,
      lastMobileActiveAt: true,
      sso: true,
    },
  });

  // A session whose auth user has no Shelf account is not a Shelf sign-in.
  // 401 sends the companion back to its login screen.
  if (!user) {
    throw new ShelfError({
      cause: null,
      message: "This session does not belong to a Shelf account",
      label: "Auth",
      status: 401,
      shouldBeCaptured: false,
    });
  }

  if (user.deletedAt) {
    throw new ShelfError({
      cause: null,
      message: "User not found in database",
      label: "Auth",
      status: 404,
    });
  }

  // The companion signs in with a password straight against Supabase, so this
  // is the first point Shelf sees that session. Refuse it when the address must
  // use SSO, as the web sign-in would. SSO users pass without a lookup: their
  // companion sessions are the SSO sessions of `User.sso` accounts. A refused account
  // has every session revoked first, so its refresh token cannot mint another
  // access token for the companion or the web.
  if (!user.sso) {
    const decision = await getLegacyLoginDecisionForUser({
      userId: user.id,
      email: user.email,
    });
    if (!decision.allowed) {
      await revokeAllSessions(token);
      throw createSsoRequiredError(decision.reason);
    }
  }

  // Record companion-app usage for adoption metrics. requireMobileAuth is the
  // single chokepoint every mobile API route passes through (QR scanner
  // included), so recording here covers them all in one place. Debounced +
  // fire-and-forget — never blocks or breaks the request (see
  // mobile-usage.server.ts).
  recordMobileActivity(user.id, user.lastMobileActiveAt);

  // Strip internal-only fields from the returned object
  const {
    deletedAt: _deletedAt,
    lastMobileActiveAt: _lastMobileActiveAt,
    sso: _sso,
    ...safeUser
  } = user;
  return { user: safeUser, authUser };
}

/**
 * Fetches a user's organizations, with their roles, in landing order.
 *
 * `organizations[0]` is the workspace the companion should open: the app has
 * no workspace cookie, so the ARRAY ORDER is the wire contract for where a
 * session lands. The order mirrors the web resolver in
 * `~/modules/organization/context.server.ts` so both clients answer "which
 * workspace am I in?" the same way:
 *
 *   1. the user's `lastSelectedOrganizationId`, when they still belong to it
 *   2. for non-SSO users, their personal workspace
 *   3. everything else, oldest first (stable across calls)
 *
 * SSO users never see their personal workspace — it is filtered out here for
 * the same reason the web filters it at every touchpoint: their membership is
 * driven by the IdP, and the personal workspace is not part of that world.
 *
 * `lastSelectedOrganizationId` is also returned explicitly (null when unset or
 * no longer valid) so the app can distinguish "the server picked for me" from
 * "I chose this workspace" without re-deriving the hierarchy.
 *
 * Each organization also carries the four workspace visibility toggles
 * (`selfServiceCanSeeBookings`, `baseUserCanSeeBookings`,
 * `selfServiceCanSeeCustody`, `baseUserCanSeeCustody`) and the permission
 * switch `managersCanEditAssets`, so the companion can resolve the same
 * `RoleAccess` and the same matrix answers the server does for that workspace.
 *
 * @param userId - the authenticated user
 * @returns organizations in landing order, plus the explicit last-selected id
 */
export async function getUserOrganizations(userId: string) {
  const userOrgs = await db.userOrganization.findMany({
    where: { userId },
    // Oldest-first base order keeps rank ties deterministic across calls; the
    // id tie-break pins organizations created in the same instant.
    orderBy: [
      { organization: { createdAt: "asc" } },
      { organization: { id: "asc" } },
    ],
    select: {
      roles: true,
      user: { select: { sso: true, lastSelectedOrganizationId: true } },
      organization: {
        select: {
          id: true,
          name: true,
          type: true,
          imageId: true,
          barcodesEnabled: true,
          auditsEnabled: true,
          // The workspace currency. Any screen that shows or collects money
          // needs it before an asset exists to read it from: asset create,
          // for one, which has no asset yet.
          currency: true,
          // why: the four workspace visibility toggles a RoleAccess resolves
          // against. Without them here the companion has no way to widen a
          // restricted role's own-scope for a given workspace.
          selfServiceCanSeeBookings: true,
          baseUserCanSeeBookings: true,
          selfServiceCanSeeCustody: true,
          baseUserCanSeeCustody: true,
          // why: the permission switches the companion passes to
          // `roleHasPermission`, so its create/edit entry points show exactly
          // what the server will accept in this workspace.
          managersCanEditAssets: true,
        },
      },
    },
  });

  const isSSO = userOrgs[0]?.user?.sso === true;
  const lastSelectedId = userOrgs[0]?.user?.lastSelectedOrganizationId ?? null;

  const visible = isSSO
    ? userOrgs.filter((uo) => uo.organization.type !== "PERSONAL")
    : userOrgs;

  const lastSelectedOrganizationId = visible.some(
    (uo) => uo.organization.id === lastSelectedId
  )
    ? lastSelectedId
    : null;

  /** Landing rank per the hierarchy above; sort is stable, so ties keep the
   * oldest-first base order. */
  const rank = (uo: (typeof visible)[number]) => {
    if (uo.organization.id === lastSelectedOrganizationId) return 0;
    if (!isSSO && uo.organization.type === "PERSONAL") return 1;
    return 2;
  };
  const ordered = [...visible].sort((a, b) => rank(a) - rank(b));

  // Serialize the *canonical* add-on capability (premium-aware), not the
  // raw DB flags, so the companion's client-side gating
  // (`currentOrg.auditsEnabled` / `.barcodesEnabled`) stays aligned with
  // the server gating, which now uses canUseAudits/canUseBarcodes. Without
  // this, non-premium/self-hosted deployments would allow the feature on
  // the API but hide it in the app.
  return {
    organizations: ordered.map((uo) => ({
      ...uo.organization,
      barcodesEnabled: canUseBarcodes(uo.organization),
      auditsEnabled: canUseAudits(uo.organization),
      roles: uo.roles,
    })),
    lastSelectedOrganizationId,
  };
}

/** The organization columns the mobile lapse gate reads. */
const MOBILE_WORKSPACE_GATE_SELECT = {
  id: true,
  type: true,
  name: true,
  imageId: true,
  userId: true,
  workspaceDisabled: true,
} as const;

/**
 * Messages the companion shows when a workspace is inactive, by why it is
 * inactive and whether the request acts in that workspace (`workspace`) or
 * opens a scanned code it owns (`code`; that workspace may not be the one the
 * app is in). They state the fact only: the phone app never points the user
 * at a purchase.
 */
export const MOBILE_INACTIVE_MESSAGES = {
  lapsed: {
    workspace:
      "This workspace is inactive because its subscription has expired.",
    code: "The workspace this code belongs to is inactive because its subscription has expired.",
  },
  disabled: {
    workspace: "This workspace has been disabled.",
    code: "The workspace this code belongs to has been disabled.",
  },
} as const;

/** Added for anyone but the owner, who is the one who can act on it. */
const CONTACT_OWNER_SUFFIX =
  "Contact the workspace owner for more information.";

/**
 * Title of the 403 an inactive workspace gets. Routes that answer with a
 * structured `reason` (the scan lookups) recognise the refusal by it, through
 * {@link isMobileWorkspaceInactiveError}.
 */
const MOBILE_WORKSPACE_INACTIVE_TITLE = "Workspace inactive";

/**
 * The `reason` a scan lookup sends with an inactive-workspace refusal, so the
 * companion can title the answer without reading the message text.
 */
export const MOBILE_WORKSPACE_INACTIVE_REASON = "workspace_inactive";

/** Why a workspace is inactive: switched off by a Shelf admin, or a lapsed Team plan. */
export type MobileWorkspaceInactiveReason = "disabled" | "lapsed";

/**
 * The message for an inactive workspace, as the caller sees it.
 *
 * @param args.inactiveReason - Why the workspace is inactive.
 * @param args.scope - `"workspace"` when the caller acts in it, `"code"` when
 *   they opened a scanned code it owns.
 * @param args.isOwner - Whether the caller owns the workspace. Anyone else is
 *   told to contact the owner, who is the one who can act on it.
 * @returns The message, without purchase wording.
 */
function inactiveWorkspaceMessage({
  inactiveReason,
  scope,
  isOwner,
}: {
  inactiveReason: MobileWorkspaceInactiveReason;
  scope: "workspace" | "code";
  isOwner: boolean;
}): string {
  const base = MOBILE_INACTIVE_MESSAGES[inactiveReason][scope];
  return isOwner ? base : `${base} ${CONTACT_OWNER_SUFFIX}`;
}

/**
 * Whether an error is the 403 an inactive workspace gets from
 * {@link getMobileWorkspaceAccess}, wrapped or not.
 *
 * @param error - Any error, usually the result of `makeShelfError`.
 * @returns `true` for the inactive-workspace refusal.
 */
export function isMobileWorkspaceInactiveError(error: ShelfError): boolean {
  return (
    error.status === 403 && error.title === MOBILE_WORKSPACE_INACTIVE_TITLE
  );
}

/**
 * Whether the web app shows a workspace as disabled. Mobile twin of the
 * `disabledTeamOrg` loader flag in `routes/_layout+/_layout.tsx`, with the same
 * three inputs:
 *
 * - `workspaceDisabled`, the switch a Shelf admin sets on the admin dashboard;
 * - a TEAM workspace whose owner's tier is `free` or `tier_1` (the paid Team
 *   plan has lapsed), decided by the shared `disabledTeamOrg`;
 * - Shelf admins pass through, as they do on web.
 *
 * Personal workspaces are never refused for their tier. `disabledTeamOrg`
 * returns false when premium features are off (self-hosted).
 *
 * @param args.isShelfAdmin - Whether the caller holds the Shelf `ADMIN` role.
 * @param args.organization - The workspace to check.
 * @returns Why the workspace is inactive for this caller (`disabled` by a
 *   Shelf admin, or `lapsed` Team plan), or `null` when it is active.
 */
async function getMobileWorkspaceInactiveReason({
  isShelfAdmin,
  organization,
}: {
  isShelfAdmin: boolean;
  organization: Pick<
    Organization,
    "id" | "type" | "name" | "imageId" | "userId" | "workspaceDisabled"
  >;
}): Promise<MobileWorkspaceInactiveReason | null> {
  if (isShelfAdmin) return null;
  if (organization.workspaceDisabled) return "disabled";
  // Only a TEAM workspace depends on the owner's paid tier, so the tier lookup
  // inside `disabledTeamOrg` runs for those alone.
  if (organization.type !== "TEAM") return null;

  const lapsed = await disabledTeamOrg({
    currentOrganization: organization,
    organizations: [organization],
    // why: `disabledTeamOrg` exempts any URL containing "account-details", a
    // web page that stays open in a lapsed workspace. The phone app has no
    // such page, and a request URL is caller-controlled, so the gate never
    // hands one over.
    url: "",
  });
  return lapsed ? "lapsed" : null;
}

/** What the caller may do in a workspace, from {@link getMobileWorkspaceAccess}. */
export type MobileWorkspaceAccess =
  | { access: "not-member" }
  | { access: "active" }
  | { access: "inactive"; error: ShelfError };

/**
 * Reads the caller's membership of a workspace together with what the lapse
 * gate needs, and answers whether the caller may act there. Never throws for
 * the answer itself: an inactive workspace comes back with the 403 to throw,
 * so a caller weighing several workspaces can skip the inactive ones.
 *
 * @param args.userId - The signed-in caller.
 * @param args.organizationId - The workspace to check.
 * @param args.reason - `"workspace"` when the request acts in this workspace,
 *   `"code"` when it opens a scanned code this workspace owns; picks the
 *   refusal message.
 * @returns `not-member`, `active`, or `inactive` with its 403 `ShelfError`.
 */
export async function getMobileWorkspaceAccess({
  userId,
  organizationId,
  reason,
}: {
  userId: string;
  organizationId: string;
  reason: "workspace" | "code";
}): Promise<MobileWorkspaceAccess> {
  const membership = await db.userOrganization.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    select: {
      id: true,
      organization: { select: MOBILE_WORKSPACE_GATE_SELECT },
      user: { select: { roles: { select: { name: true } } } },
    },
  });

  if (!membership) return { access: "not-member" };

  const { organization } = membership;
  const inactiveReason = await getMobileWorkspaceInactiveReason({
    // `Roles` is the Shelf system role (Shelf staff), not a workspace role.
    isShelfAdmin: membership.user.roles.some(
      (role) => role.name === Roles.ADMIN
    ),
    organization,
  });

  if (!inactiveReason) return { access: "active" };

  return {
    access: "inactive",
    error: new ShelfError({
      cause: null,
      title: MOBILE_WORKSPACE_INACTIVE_TITLE,
      message: inactiveWorkspaceMessage({
        inactiveReason,
        scope: reason,
        // `organization.userId` is the workspace owner.
        isOwner: organization.userId === userId,
      }),
      additionalData: { userId, organizationId },
      label: "Auth",
      status: 403,
      shouldBeCaptured: false,
    }),
  };
}

/** Whether one of the caller's workspaces is active, as `/api/mobile/me` reports it. */
export type MobileWorkspaceState = {
  /** `true` when the mobile API refuses requests in this workspace. */
  inactive: boolean;
  /** Why it is inactive, or `null` when it is active. */
  inactiveReason: MobileWorkspaceInactiveReason | null;
  /** What the app shows for it, or `null` when it is active. */
  inactiveMessage: string | null;
};

/**
 * Reads, for each of the caller's workspaces, whether the mobile API refuses
 * requests there. Same rules as {@link getMobileWorkspaceAccess}, so the app
 * can mark an inactive workspace before any request in it fails.
 *
 * @param args.userId - The signed-in caller.
 * @param args.organizationIds - The caller's workspaces, as `/me` lists them.
 * @returns The state of each workspace, keyed by its id. An id the caller is
 *   not a member of, or whose state could not be read (logged), is left out.
 */
export async function getMobileWorkspaceStates({
  userId,
  organizationIds,
}: {
  userId: string;
  organizationIds: string[];
}): Promise<Map<string, MobileWorkspaceState>> {
  const states = new Map<string, MobileWorkspaceState>();
  if (organizationIds.length === 0) return states;

  const memberships = await db.userOrganization.findMany({
    where: { userId, organizationId: { in: organizationIds } },
    select: {
      organization: { select: MOBILE_WORKSPACE_GATE_SELECT },
      user: { select: { roles: { select: { name: true } } } },
    },
  });

  // A TEAM workspace that is not switched off lapses with its owner's tier, so
  // workspaces sharing an owner share one tier read.
  const reasonByKey = new Map<
    string,
    Promise<MobileWorkspaceInactiveReason | null>
  >();

  await Promise.all(
    memberships.map(async ({ organization, user }) => {
      // `Roles` is the Shelf system role (Shelf staff), not a workspace role.
      const isShelfAdmin = user.roles.some((role) => role.name === Roles.ADMIN);
      const key =
        !isShelfAdmin &&
        organization.type === "TEAM" &&
        !organization.workspaceDisabled
          ? `owner:${organization.userId}`
          : `workspace:${organization.id}`;
      let reason = reasonByKey.get(key);
      if (!reason) {
        reason = getMobileWorkspaceInactiveReason({
          isShelfAdmin,
          organization,
        });
        reasonByKey.set(key, reason);
      }

      // Each workspace is decided on its own: one failed read leaves that
      // workspace out (the caller reports it active; every other route still
      // refuses it), and the others keep their answer.
      let inactiveReason: MobileWorkspaceInactiveReason | null;
      try {
        inactiveReason = await reason;
      } catch (cause) {
        Logger.error(
          new ShelfError({
            cause,
            message: "Failed to read whether a workspace is active",
            additionalData: { userId, organizationId: organization.id },
            label: "Auth",
          })
        );
        return;
      }

      states.set(organization.id, {
        inactive: inactiveReason !== null,
        inactiveReason,
        inactiveMessage: inactiveReason
          ? inactiveWorkspaceMessage({
              inactiveReason,
              scope: "workspace",
              // `organization.userId` is the workspace owner.
              isOwner: organization.userId === userId,
            })
          : null,
      });
    })
  );

  return states;
}

/**
 * Resolves the organizationId from the request and verifies the user has
 * access to it: a membership, in a workspace that is active (see
 * `getMobileWorkspaceAccess`). Returns the organizationId.
 *
 * Mobile clients send orgId as a query param or x-shelf-organization header.
 *
 * @throws {ShelfError} 400 without an org id, 403 when the caller is not a
 *   member or the workspace is inactive.
 */
export async function requireOrganizationAccess(
  request: Request,
  userId: string
): Promise<string> {
  const url = new URL(request.url);
  const orgId =
    url.searchParams.get("orgId") ||
    request.headers.get("x-shelf-organization");

  if (!orgId) {
    throw new ShelfError({
      cause: null,
      message:
        "Missing organization ID. Pass orgId as query param or x-shelf-organization header.",
      label: "Auth",
      status: 400,
    });
  }

  const workspace = await getMobileWorkspaceAccess({
    userId,
    organizationId: orgId,
    reason: "workspace",
  });

  if (workspace.access === "inactive") throw workspace.error;

  if (workspace.access === "not-member") {
    throw new ShelfError({
      cause: null,
      message: "You don't have access to this organization",
      label: "Auth",
      status: 403,
    });
  }

  return orgId;
}

/**
 * Enforces RBAC permission checks for mobile API routes.
 *
 * Resolves through the same `hasPermission` as the webapp, which loads the
 * membership's roles and the workspace's permission switches in one query,
 * so mobile and web have identical authorization rules.
 *
 * @param args.matrixOnly - `true` answers from the matrix alone, for a
 *   route that shares a pair with a path a workspace switch opens but must
 *   stay closed to the role the switch opens it for
 * @throws {ShelfError} 403 when the caller lacks the permission
 */
export async function requireMobilePermission({
  userId,
  organizationId,
  entity,
  action,
  matrixOnly,
}: {
  userId: string;
  organizationId: string;
  entity: PermissionEntity;
  action: PermissionAction;
  matrixOnly?: boolean;
}) {
  await validatePermission({
    userId,
    organizationId,
    entity,
    action,
    matrixOnly,
  });
}

/**
 * Fetches the caller's roles, reach and the org capability flags that every
 * mobile route gates on. `canUseAudits`/`canUseBarcodes` reuse the canonical
 * subscription.server predicates so mobile matches webapp gating exactly.
 *
 * `access` folds the membership's policy (read from its highest-rank role)
 * with the workspace's visibility toggles, resolved by the same
 * `resolveRoleAccess` web's `requirePermission` uses, so the two platforms
 * cannot disagree about what a workspace has granted. Its booking and custody
 * visibility answers are independent: a workspace may grant either without
 * the other. Neither widens a MUTATION: writes stay on the role's permission
 * grant plus `validateBookingOwnership`.
 *
 * Used by mobile routes that call service layer functions requiring
 * `getAssetIndexSettings` (e.g. bulkAssignCustody, bulkReleaseCustody) and by
 * every route that must gate booking or custody visibility server-side.
 */
export async function getMobileUserContext(
  userId: string,
  organizationId: string
): Promise<{
  /** Every role on this membership, for matrix checks (`hasPermission`), which union held roles. */
  roles: OrganizationRoles[];
  /**
   * The member's reach: effective role, booking/custody/audit scopes, and
   * `workspaceGrants`, the switches to pass as `workspace` alongside `roles`
   * to `hasPermission`. Every gate reads this.
   */
  access: RoleAccess;
  canUseBarcodes: boolean;
  canUseAudits: boolean;
}> {
  const userOrg = await db.userOrganization.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    select: {
      roles: true,
      organization: {
        select: {
          barcodesEnabled: true,
          auditsEnabled: true,
          // why: custody visibility is permission-gated per-org (web parity,
          // see mobile-custody-visibility.server.ts); resolving the overrides
          // here keeps it one query alongside the role.
          selfServiceCanSeeCustody: true,
          baseUserCanSeeCustody: true,
          // why: the booking twins of the two custody flags above. Every
          // mobile booking read - list, calendar, detail, dashboard - takes
          // its visibility answer from this row, so the columns have to be
          // here for the workspace setting to reach them at all.
          selfServiceCanSeeBookings: true,
          baseUserCanSeeBookings: true,
          // why: the workspace's permission switches. `access.workspaceGrants`
          // carries them to every `hasPermission` call made with these roles.
          managersCanEditAssets: true,
        },
      },
    },
  });

  if (!userOrg) {
    throw new ShelfError({
      cause: null,
      message: "User organization membership not found",
      label: "Auth",
      status: 403,
    });
  }

  return {
    roles: userOrg.roles,
    access: resolveRoleAccess({
      roles: userOrg.roles,
      workspace: userOrg.organization,
    }),
    canUseBarcodes: canUseBarcodes(userOrg.organization),
    canUseAudits: canUseAudits(userOrg.organization),
  };
}

/**
 * Asserts the organization may use bookings — a TEAM-plan feature. Mobile twin
 * of the web route-layer `assertCanUseBookings` gate.
 *
 * `requireOrganizationAccess` only proves membership and returns the org id, so
 * this loads the org `type` before asserting. Every mobile booking endpoint
 * (create/update/reserve/remove + checkout/checkin/partial) should call this so
 * personal workspaces can't use bookings on mobile, matching web.
 *
 * @param organizationId - The caller's active organization id.
 * @throws {ShelfError} 404 if the org is missing; 403 for personal workspaces.
 */
export async function assertMobileCanUseBookings(organizationId: string) {
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { type: true },
  });

  if (!organization) {
    throw new ShelfError({
      cause: null,
      message: "Organization not found.",
      label: "Auth",
      status: 404,
    });
  }

  assertCanUseBookings(organization);
}

/**
 * Shared Prisma select shape for asset data returned by mobile scanner endpoints.
 * Used by both QR and barcode resolution routes for consistent responses.
 *
 * NOTE: Post-Phase-4a/4b the `Asset` model no longer carries direct `kitId` or
 * `location` columns — kit linkage now lives on the `AssetKit` pivot
 * (`assetKits`) and location on the `AssetLocation` pivot (`assetLocations`).
 * Custody also became 1:many (`Custody[]`). The companion app currently in
 * App Store review (since 2026-05-20) consumes the legacy flat shape
 * (`asset.kit`, `asset.kitId`, `asset.location`, `asset.custody` as a single
 * object). To keep that live build working without a forced update, mobile
 * routes fetch this select and then call `shapeMobileAssetResponse` to
 * flatten the pivot rows into the legacy shape — mirroring the
 * `MOBILE_KIT_SELECT` + `shapeMobileKitResponse` pair below.
 */
export const MOBILE_ASSET_SELECT = {
  id: true,
  title: true,
  status: true,
  // The workspace-visible identifier ("SAM-0017"). Web shows it on the asset
  // overview and the scanner invites you to type one, so every mobile surface
  // that names an asset needs to be able to show WHICH id it is.
  sequentialId: true,
  mainImage: true,
  thumbnailImage: true,
  // Lets `resignAndShapeMobileAsset` tell a lapsed photo URL; the shaper drops
  // it from the response.
  mainImageExpiration: true,
  // Cover image of the asset's model. `shapeMobileAssetResponse` resolves the
  // cascade into `mainImage`/`thumbnailImage` before the row leaves the server,
  // so the companion inherits model images with no client release.
  ...ASSET_MODEL_IMAGE_SELECT,
  // why: powers the scan-to-booking "not available to book" blocker.
  availableToBook: true,
  // Archived assets are read-only and out of service. The companion shows one
  // "Archived" badge instead of the live status and turns their actions off.
  archivedAt: true,
  // why: the fulfil-and-check-out scanner matches each scan against the
  // booking's outstanding BookingModelRequests. Without the model id the
  // client cannot tell a matching unit from an off-model one, and can only
  // count scans — which reads as progress toward a reservation it may not
  // actually fulfil.
  assetModelId: true,
  // Quantity fields (additive). INDIVIDUAL assets carry `type: "INDIVIDUAL"`
  // and null quantity columns; QUANTITY_TRACKED assets surface the totals the
  // companion will use to DISPLAY quantity. The shaper passes these through
  // verbatim alongside the existing legacy fields.
  type: true,
  quantity: true,
  minQuantity: true,
  unitOfMeasure: true,
  consumptionType: true,
  category: { select: { name: true } },
  // Kit linkage now lives on the `AssetKit` pivot. shapeMobileAssetResponse
  // flattens `assetKits[0]` to top-level `kit` + `kitId` so the in-App-Store
  // companion's `asset.kit` / `asset.kitId` reads still work.
  assetKits: {
    select: { kit: { select: { id: true, name: true } } },
  },
  // Location ditto via the `AssetLocation` pivot — flattened to top-level
  // `location` by the shaper.
  assetLocations: {
    select: { location: { select: { id: true, name: true } } },
  },
  // Custody is now 1:many; the shaper flattens `custody[0]` so companion's
  // `asset.custody?.custodian` single-object read still works. We also select
  // `quantity` so the shaper can surface the many-aware `custodyList` (the
  // legacy single `custody` stays in place too). Ordered by `createdAt` so
  // both the flattened `custody[0]` and `custodyList` are deterministic
  // (the relation is otherwise unordered).
  custody: {
    orderBy: { createdAt: "asc" },
    select: {
      quantity: true,
      // why: `kitCustodyId` discriminates operator-assigned rows (null) from
      // kit-allocated rows — the shaper sums the operator-only portion into
      // `releasableQuantity` (kit-allocated units are released via the kit).
      kitCustodyId: true,
      // why: `custodian.userId` lets the companion recognize the caller's own
      // custody row (self-service users may only release their own units).
      // Web parity: CustodyCard already ships custodianUserId to the client.
      custodian: { select: { id: true, name: true, userId: true } },
    },
  },
} as const;

/**
 * Shared Prisma select shape for kit data returned by mobile scanner
 * endpoints (QR/barcode resolution). The per-asset statuses power the
 * scanner's kit batch blockers ("kit has assets in custody"), mirroring the
 * web scanner drawers.
 *
 * NOTE: `Kit` no longer exposes a direct `assets` relation — it is now joined
 * via the `AssetKit` pivot (`assetKits`). We still need to surface the
 * per-asset status/availableToBook to the companion app in the legacy flat
 * shape (`kit.assets: {id,status,availableToBook}[]` + `kit._count.assets`)
 * so the existing mobile clients in the App Store don't break. Mobile
 * endpoints fetch this select shape and then call
 * `shapeMobileKitResponse` to flatten the pivot rows.
 *
 * Every member is selected, archived ones included, with its `archivedAt`:
 * `shapeMobileKitResponse` splits them into the active members the phone
 * lists and counts, and the archived count it reports apart.
 */
export const MOBILE_KIT_SELECT = {
  id: true,
  name: true,
  status: true,
  image: true,
  // why: per-asset status powers the "kit has assets in custody" blocker;
  // availableToBook powers the scan-to-booking "kit has unavailable assets"
  // blocker, both mirroring the web scanner drawers. `archivedAt` lets the
  // shaper keep archived members out of both: the server books, hands over and
  // moves a kit with its active members only, so an archived member must not
  // block the kit on the phone. A kit holding only archived assets has nothing
  // to book or hand over, and the phone flags it from the archived count.
  assetKits: {
    select: {
      asset: {
        select: {
          id: true,
          status: true,
          availableToBook: true,
          archivedAt: true,
        },
      },
    },
  },
} as const;

/**
 * Shape returned to mobile clients for a scanned kit. Preserves the legacy
 * flat `assets` + `_count.assets` contract so the companion app continues
 * to work unchanged after the `Kit.assets` → `Kit.assetKits` migration.
 */
export type MobileKitResponse = {
  id: string;
  name: string;
  status: string;
  image: string | null;
  /** Active members: the scanner's "Kit • N assets". */
  _count: { assets: number };
  /**
   * Archived members, left out of `assets` and `_count`. A kit with archived
   * members and no active one holds nothing to book or hand over.
   */
  archivedAssetCount: number;
  assets: Array<{
    id: string;
    status: string;
    availableToBook: boolean;
  }>;
};

/**
 * Flattens a kit row fetched with `MOBILE_KIT_SELECT` (which uses the
 * `assetKits` pivot) into the legacy `{ assets, _count: { assets } }` shape
 * expected by the companion app's scanner. Returns `null` if the input is
 * `null` so callers can pass through directly.
 *
 * `assetKits` holds every member, one row per asset (`AssetKit` is unique per
 * asset and kit). The active ones become `assets` and `_count.assets`; the
 * archived ones are only counted, as `archivedAssetCount`.
 *
 * @param kit Kit row selected via `MOBILE_KIT_SELECT`, or `null`
 * @returns The legacy mobile response shape, or `null`
 */
export function shapeMobileKitResponse(
  kit: {
    id: string;
    name: string;
    status: string;
    image: string | null;
    assetKits: Array<{
      asset: {
        id: string;
        status: string;
        availableToBook: boolean;
        archivedAt: Date | null;
      };
    }>;
  } | null
): MobileKitResponse | null {
  if (!kit) return null;
  const assets = kit.assetKits
    .filter((ak) => ak.asset.archivedAt === null)
    .map(({ asset: { id, status, availableToBook } }) => ({
      id,
      status,
      availableToBook,
    }));
  return {
    id: kit.id,
    name: kit.name,
    status: kit.status,
    image: kit.image,
    _count: { assets: assets.length },
    archivedAssetCount: kit.assetKits.length - assets.length,
    assets,
  };
}

/**
 * Shape returned to mobile clients for a single asset. Preserves the legacy
 * flat contract — top-level `kit` / `kitId` / `location` / `custody` (as a
 * single-or-null object) — so the companion app currently in App Store review
 * (since 2026-05-20) keeps working unchanged after the Phase-4a/4b migrations
 * that moved kit/location onto pivots and turned custody into a 1:many
 * relation on `Asset`.
 */
export type MobileAssetResponse = {
  id: string;
  title: string;
  status: string;
  /** Workspace-visible identifier, e.g. "SAM-0017". Null until one is assigned. */
  sequentialId: string | null;
  /** Model this asset belongs to, or null. Drives fulfil-scan matching. */
  assetModelId?: string | null;
  /**
   * Image to render, with the model-image cascade already resolved: the
   * asset's own image, else its model's cover image, else `null` (the
   * companion draws its own placeholder — the placeholder PATH is never sent).
   */
  mainImage: string | null;
  /** 108px counterpart of {@link mainImage}, resolved from the same tier. */
  thumbnailImage: string | null;
  /**
   * Where {@link mainImage} came from. Additive — lets the companion label an
   * inherited image later without a second request.
   */
  imageSource: AssetImageSource;
  availableToBook: boolean;
  /**
   * When the asset was archived, `null` while it is active. Archived assets
   * are read-only: the companion badges them "Archived" and offers no action
   * the server would refuse.
   */
  archivedAt: Date | null;
  category: { name: string } | null;
  kitId: string | null;
  kit: { id: string; name: string } | null;
  location: { id: string; name: string } | null;
  // Legacy single custody. `custodian.userId` is additive (nullable — NRM
  // custodians have no linked auth user); web's CustodyCard ships it too.
  custody: {
    custodian: { id: string; name: string; userId: string | null };
  } | null;
  // Quantity fields (additive). Surfaced so the companion can DISPLAY
  // quantity data; the existing legacy fields above are unchanged.
  type: AssetType;
  quantity: number | null;
  minQuantity: number | null;
  unitOfMeasure: string | null;
  consumptionType: ConsumptionType | null;
  // Many-aware custody list. `custody` (above) keeps the legacy single
  // object for the in-App-Store build; `custodyList` carries every row with
  // its quantity for QUANTITY_TRACKED assets that may have multiple holders.
  // `custodian.userId` (nullable — NRM custodians have none) lets the app
  // recognize the caller's own row; `releasableQuantity` is the operator-
  // assigned portion (kit-allocated units release via the kit's custody).
  custodyList: Array<{
    custodian: { id: string; name: string; userId: string | null };
    quantity: number;
    releasableQuantity: number;
  }>;
};

/**
 * Flattens an asset row fetched with `MOBILE_ASSET_SELECT` (which surfaces the
 * `assetKits`, `assetLocations`, and 1:many `custody` relations as arrays)
 * into the legacy flat shape (`kit`, `kitId`, `location`, single-or-null
 * `custody`) expected by the companion app's scanner / list / detail routes.
 *
 * Mirrors `shapeMobileKitResponse` above — same JSDoc style, same null
 * semantics, same flatten-the-pivot pattern. The kit/location/custody
 * flattening picks the first row from each pivot/relation: INDIVIDUAL assets
 * are capped at one row per pivot by DB triggers, so this is lossless for the
 * current companion contract. QUANTITY_TRACKED assets (Phase 4a+) may have
 * multiple rows, but they're out of scope for the in-review companion build
 * (see plan: Phase 4d will expose the richer pivot data after companion
 * ships QT support).
 *
 * The input type is hand-mirrored from `MOBILE_ASSET_SELECT` (not derived via
 * `Prisma.AssetGetPayload`) to match the local convention established by
 * `shapeMobileKitResponse` and to avoid Prisma's deep-generic recursion
 * warnings on selects that nest pivot relations.
 *
 * @param asset Asset row selected via `MOBILE_ASSET_SELECT`
 * @returns The legacy flat mobile response shape
 */
export function shapeMobileAssetResponse(asset: {
  id: string;
  title: string;
  status: string;
  sequentialId: string | null;
  mainImage: string | null;
  thumbnailImage: string | null;
  /**
   * Dropped below, so the response shape does not change. Optional because
   * some callers build this argument by hand; {@link MobileAssetSelectRow}
   * makes it required where a photo is re-signed.
   */
  mainImageExpiration?: Date | null;
  assetModel: { image: string | null; thumbnailImage: string | null } | null;
  availableToBook: boolean;
  archivedAt: Date | null;
  category: { name: string } | null;
  type: AssetType;
  quantity: number | null;
  minQuantity: number | null;
  unitOfMeasure: string | null;
  consumptionType: ConsumptionType | null;
  assetKits: Array<{ kit: { id: string; name: string } }>;
  assetLocations: Array<{ location: { id: string; name: string } }>;
  custody: Array<{
    quantity: number;
    kitCustodyId: string | null;
    custodian: { id: string; name: string; userId: string | null };
  }>;
}): MobileAssetResponse {
  const {
    assetKits,
    assetLocations,
    custody,
    mainImageExpiration: _mainImageExpiration,
    ...rest
  } = asset;
  const kit = assetKits[0]?.kit ?? null;
  /**
   * Collapse the model-image cascade before the row leaves the server. The
   * companion reads `mainImage`/`thumbnailImage` directly and cannot be
   * updated in lockstep with the API (native binary, no OTA for native
   * changes), so resolving here is what makes inherited images work without a
   * client release. `imageSource` is additive, for later provenance UI.
   */
  const image = serializeAssetImage(rest);
  // Aggregate custody rows by custodian so a holder with more than one row on
  // the same asset (e.g. a kit-driven row plus a standalone row) shows once
  // with their summed quantity rather than duplicated. Insertion order follows
  // the `createdAt`-ordered select, so the list stays deterministic.
  // `releasableQuantity` sums only operator-assigned rows (kitCustodyId null);
  // kit-allocated units are only released by releasing the kit's custody.
  const custodyList: MobileAssetResponse["custodyList"] = [];
  const custodyIndexById = new Map<string, number>();
  for (const c of custody) {
    const releasable = c.kitCustodyId === null ? c.quantity : 0;
    const existingIndex = custodyIndexById.get(c.custodian.id);
    if (existingIndex === undefined) {
      custodyIndexById.set(c.custodian.id, custodyList.length);
      custodyList.push({
        custodian: c.custodian,
        quantity: c.quantity,
        releasableQuantity: releasable,
      });
    } else {
      custodyList[existingIndex].quantity += c.quantity;
      custodyList[existingIndex].releasableQuantity += releasable;
    }
  }
  return {
    // `...image` carries `...rest` through verbatim (including the new scalar
    // quantity fields) with the image cascade already resolved.
    ...image,
    kitId: kit?.id ?? null,
    kit,
    location: assetLocations[0]?.location ?? null,
    // Legacy single-or-null custody for the in-App-Store build. `userId` is
    // additive (web parity: CustodyCard ships custodianUserId too).
    custody: custody[0] ? { custodian: custody[0].custodian } : null,
    // Many-aware custody list (additive) — every holder + their summed quantity.
    custodyList,
  };
}

/**
 * A row selected with `MOBILE_ASSET_SELECT`. Unlike the shaper's own parameter,
 * `mainImageExpiration` is required, so a select that drops it fails to compile
 * instead of silently skipping the photo re-sign.
 */
export type MobileAssetSelectRow = Parameters<
  typeof shapeMobileAssetResponse
>[0] & { mainImageExpiration: Date | null };

/**
 * Re-signs a `MOBILE_ASSET_SELECT` row's lapsed photo URL, then shapes the row
 * for the companion.
 *
 * Every path that returns such a row goes through this one step: the scanner
 * resolvers and the asset returned after a quantity or custody change.
 *
 * @param asset - A row selected with `MOBILE_ASSET_SELECT`.
 * @param organizationId - The workspace that owns the asset. For a code
 *   resolved in a sibling workspace, that workspace rather than the caller's.
 * @returns The legacy flat mobile response shape.
 * @see {@link file://./../asset/service.server.ts} refreshExpiredAssetImages
 */
export async function resignAndShapeMobileAsset(
  asset: MobileAssetSelectRow,
  organizationId: string
): Promise<MobileAssetResponse> {
  const [refreshed] = await refreshExpiredAssetImages([asset], {
    organizationId,
    ...ASSET_IMAGE_RESIGN_LIMITS,
  });
  return shapeMobileAssetResponse(refreshed);
}

/**
 * `MobileAssetResponse` with its custody scoped to one viewer by
 * `scopeMobileAssetCustodyToViewer`: `custodyListOthersCount` is the number of
 * holders hidden from the viewer (0 when the viewer can see all custody), so
 * the companion can render "+N others", mirroring the web's
 * `QuantityCustodyList` hidden-count (quantity-custody-list.tsx:126).
 */
export type MobileAssetForViewer = MobileAssetResponse & {
  custodyListOthersCount: number;
};

/**
 * Fetches an asset and shapes it for a SPECIFIC mobile viewer: the standard
 * `MOBILE_ASSET_SELECT` + `shapeMobileAssetResponse` pair, with the custody
 * fields filtered by the web's custody-visibility rules (see
 * mobile-custody-visibility.server.ts) so viewers without custody-view
 * permission only receive their own custody entries.
 *
 * Used by the quantity-custody action endpoints to return the refreshed
 * asset in the success envelope, saving the app a second round trip.
 *
 * @param args.assetId - The asset to fetch (org-scoped)
 * @param args.organizationId - The caller's active organization
 * @param args.viewerUserId - The authenticated caller's user id
 * @param args.canSeeAllCustody - The viewer's `access.custody.seeAll`, from {@link getMobileUserContext}
 * @returns The viewer-shaped asset, or null when not found in the org
 */
export async function getMobileAssetForViewer({
  assetId,
  organizationId,
  viewerUserId,
  canSeeAllCustody,
}: {
  assetId: string;
  organizationId: string;
  viewerUserId: string;
  canSeeAllCustody: boolean;
}): Promise<MobileAssetForViewer | null> {
  const asset = await db.asset.findUnique({
    // why: inline-scope to org so cross-org probes read nothing — matches
    // the pattern used by every other mobile route.
    // eslint-disable-next-line local-rules/require-archived-at-check-on-asset-queries -- why: by-id refresh of the asset the caller just acted on; the detail view still shows archived assets
    where: { id: assetId, organizationId },
    // MOBILE_ASSET_SELECT's custody select already carries `custodian.userId`
    // (own-row detection; web parity) and `kitCustodyId` (releasableQuantity).
    // Shipping userId on VISIBLE rows is deliberate — privacy is enforced by
    // the row-level filter below, which removes rows the viewer may not see.
    select: MOBILE_ASSET_SELECT,
  });

  if (!asset) return null;

  const shaped = await resignAndShapeMobileAsset(asset, organizationId);

  return scopeMobileAssetCustodyToViewer(shaped, {
    viewerUserId,
    canSeeAllCustody,
  });
}

/**
 * The `{ error }` body a scan lookup sends for a thrown error. An
 * inactive-workspace refusal carries `reason: "workspace_inactive"`, so the
 * companion scanner can title it as such; any other error carries the message
 * alone, as every mobile route does.
 *
 * @param error - The error, as `makeShelfError` returns it.
 * @returns The value for the response's `error` field.
 */
export function mobileScanErrorBody(error: ShelfError): {
  message: string;
  reason?: typeof MOBILE_WORKSPACE_INACTIVE_REASON;
} {
  return isMobileWorkspaceInactiveError(error)
    ? { message: error.message, reason: MOBILE_WORKSPACE_INACTIVE_REASON }
    : { message: error.message };
}
