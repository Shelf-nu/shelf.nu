import { db } from "~/database/db.server";
import { getSupabaseAdmin } from "~/integrations/supabase/client";
import { ShelfError } from "~/utils/error";
import {
  type PermissionAction,
  type PermissionEntity,
} from "~/utils/permissions/permission.data";
import { validatePermission } from "~/utils/permissions/permission.validator.server";

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

  // Strip deletedAt from the returned object
  const { deletedAt: _, ...safeUser } = user;
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
        },
      },
    },
  });

  return userOrgs.map((uo) => ({
    ...uo.organization,
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
