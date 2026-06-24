import { OrganizationRoles } from "@prisma/client";
import { db } from "~/database/db.server";
import { getSupabaseAdmin } from "~/integrations/supabase/client";
import { ShelfError } from "~/utils/error";
import {
  type PermissionAction,
  type PermissionEntity,
} from "~/utils/permissions/permission.data";
import { validatePermission } from "~/utils/permissions/permission.validator.server";
import {
  assertCanUseBookings,
  canUseAudits,
  canUseBarcodes,
} from "~/utils/subscription.server";
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

  // Get the database user record — exclude soft-deleted users
  const user = await db.user.findUnique({
    where: { email: authUser.email },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      profilePicture: true,
      onboarded: true,
      deletedAt: true,
      lastMobileActiveAt: true,
    },
  });

  if (!user || user.deletedAt) {
    throw new ShelfError({
      cause: null,
      message: "User not found in database",
      label: "Auth",
      status: 404,
    });
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
    ...safeUser
  } = user;
  return { user: safeUser, authUser };
}

/**
 * Fetches organizations for a user, with their roles.
 */
export async function getUserOrganizations(userId: string) {
  const userOrgs = await db.userOrganization.findMany({
    where: { userId },
    select: {
      roles: true,
      organization: {
        select: {
          id: true,
          name: true,
          type: true,
          imageId: true,
          barcodesEnabled: true,
          auditsEnabled: true,
        },
      },
    },
  });

  // Serialize the *canonical* add-on capability (premium-aware), not the
  // raw DB flags, so the companion's client-side gating
  // (`currentOrg.auditsEnabled` / `.barcodesEnabled`) stays aligned with
  // the server gating, which now uses canUseAudits/canUseBarcodes. Without
  // this, non-premium/self-hosted deployments would allow the feature on
  // the API but hide it in the app.
  return userOrgs.map((uo) => ({
    ...uo.organization,
    barcodesEnabled: canUseBarcodes(uo.organization),
    auditsEnabled: canUseAudits(uo.organization),
    roles: uo.roles,
  }));
}

/**
 * Resolves the organizationId from the request and verifies
 * the user has access to it. Returns the organizationId.
 *
 * Mobile clients send orgId as a query param or x-shelf-organization header.
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

  const membership = await db.userOrganization.findUnique({
    where: { userId_organizationId: { userId, organizationId: orgId } },
    select: { id: true },
  });

  if (!membership) {
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
 * Uses the same Role2PermissionMap as the webapp to ensure mobile
 * and web have identical authorization rules.
 */
export async function requireMobilePermission({
  userId,
  organizationId,
  entity,
  action,
}: {
  userId: string;
  organizationId: string;
  entity: PermissionEntity;
  action: PermissionAction;
}) {
  await validatePermission({
    userId,
    organizationId,
    entity,
    action,
  });
}

/**
 * Fetches the user's role and org capability flags (barcodes, audits) for
 * a given organization. `canUseAudits`/`canUseBarcodes` reuse the canonical
 * subscription.server predicates so mobile matches webapp gating exactly.
 *
 * Used by mobile routes that call service layer functions requiring
 * `getAssetIndexSettings` (e.g. bulkAssignCustody, bulkReleaseCustody).
 */
export async function getMobileUserContext(
  userId: string,
  organizationId: string
): Promise<{
  role: OrganizationRoles;
  canUseBarcodes: boolean;
  canUseAudits: boolean;
}> {
  const userOrg = await db.userOrganization.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    select: {
      roles: true,
      organization: {
        select: { barcodesEnabled: true, auditsEnabled: true },
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
    // why: roles is an array but we always operate on the first role; mirror
    // the convention used in roles.server.ts and invite/service.server.ts so
    // an empty array doesn't surface as `undefined` to downstream callers.
    role: userOrg.roles[0] ?? OrganizationRoles.BASE,
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
 */
export const MOBILE_ASSET_SELECT = {
  id: true,
  title: true,
  status: true,
  mainImage: true,
  // why: kitId powers the scanner's "part of a kit" batch blocker — assets
  // inside a kit must be (un)assigned via the kit, mirroring the web drawers.
  kitId: true,
  // why: powers the scan-to-booking "not available to book" blocker.
  availableToBook: true,
  category: { select: { name: true } },
  location: { select: { name: true } },
} as const;

/**
 * Shared Prisma select shape for kit data returned by mobile scanner
 * endpoints (QR/barcode resolution). The per-asset statuses power the
 * scanner's kit batch blockers ("kit has assets in custody"), mirroring the
 * web scanner drawers.
 */
export const MOBILE_KIT_SELECT = {
  id: true,
  name: true,
  status: true,
  image: true,
  _count: { select: { assets: true } },
  // why: per-asset status powers the "kit has assets in custody" blocker;
  // availableToBook powers the scan-to-booking "kit has unavailable assets"
  // blocker — both mirror the web scanner drawers.
  assets: { select: { id: true, status: true, availableToBook: true } },
} as const;
