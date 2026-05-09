/**
 * Helpers used by the user-facing /portal routes ("L'Attrezzoteca").
 *
 * A portal user is a regular shelf User attached to a single fixed organization
 * (PORTAL_ORG_ID env). Their OrganizationRole determines whether bookings they
 * create are auto-RESERVED (BASE/ADMIN/OWNER) or land as DRAFT for an admin to
 * approve (SELF_SERVICE).
 */

import { OrganizationRoles } from "@prisma/client";
import { redirect } from "react-router";
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";

const label = "Portal";

/**
 * Resolves the FabLab organization id portal joiners attach to.
 *
 * Resolution order:
 *   1. PORTAL_ORG_ID env var, if set AND that org exists → use it (override)
 *   2. Oldest TEAM organization → "the FabLab" (the workspace the admin
 *      creates for actual member management)
 *   3. Oldest organization of any type → fallback so the portal still
 *      loads before the admin has created a TEAM workspace (catalog will
 *      work, but team management UI in shelf will be hidden by shelf's
 *      own PERSONAL-org gating)
 *   4. No organizations at all → instruct the operator
 *
 * Not cached: dropping the cache lets the portal switch over the moment
 * the admin creates a TEAM workspace, with no restart required.
 */
export async function resolvePortalOrgId(): Promise<string> {
  const envId = process.env.PORTAL_ORG_ID?.trim();
  if (envId) {
    const fromEnv = await db.organization.findUnique({
      where: { id: envId },
      select: { id: true },
    });
    if (fromEnv) return fromEnv.id;
    // Env points to a non-existent org — fall through to discovery.
  }

  const team = await db.organization.findFirst({
    where: { type: "TEAM" },
    select: { id: true },
    orderBy: { updatedAt: "asc" },
  });
  if (team) return team.id;

  const anyOrg = await db.organization.findFirst({
    select: { id: true },
    orderBy: { updatedAt: "asc" },
  });
  if (anyOrg) return anyOrg.id;

  throw new ShelfError({
    cause: null,
    message:
      "Nessuna organizzazione disponibile. Un amministratore deve prima registrarsi su shelf (/join) per creare l'organizzazione FabLab.",
    label,
  });
}

/**
 * L'Attrezzoteca approval policy: which roles can finalize a portal
 * booking without admin review.
 *   - SELF_SERVICE: regular portal members. Joining the portal IS the
 *     trust check, so their bookings auto-RESERVE.
 *   - OWNER / ADMIN: FabLab operators, obviously trusted.
 *   - BASE: lower-trust intermediate role; their bookings sit as DRAFT
 *     until an admin approves from /bookings.
 *
 * Inverts the shelf-core convention (where BASE is treated as trusted
 * and SELF_SERVICE as restricted). Mirrored in bookings.new.tsx action.
 */
export function canSelfCheckout(roles: OrganizationRoles[]): boolean {
  return roles.some(
    (r) =>
      r === OrganizationRoles.OWNER ||
      r === OrganizationRoles.ADMIN ||
      r === OrganizationRoles.SELF_SERVICE
  );
}

export type PortalUser = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  profilePicture: string | null;
  /** Roles within the FabLab org (PORTAL_ORG_ID). */
  roles: OrganizationRoles[];
  /** True when the user can checkout bookings without admin approval. */
  canSelfCheckout: boolean;
  organizationId: string;
};

/**
 * Loads the logged-in user along with their roles inside the FabLab org.
 * Redirects to /portal/login if not authenticated, or to a "no access" page
 * if the user isn't attached to the FabLab org.
 */
export async function requirePortalUser(
  context: { isAuthenticated: boolean; getSession: () => { userId: string } },
  request: Request
): Promise<PortalUser> {
  if (!context.isAuthenticated) {
    const url = new URL(request.url);
    const next = `${url.pathname}${url.search}`;
    throw redirect(`/portal/login?redirectTo=${encodeURIComponent(next)}`);
  }
  const orgId = await resolvePortalOrgId();
  const { userId } = context.getSession();

  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      profilePicture: true,
      userOrganizations: {
        where: { organizationId: orgId },
        select: { roles: true },
      },
    },
  });

  if (!user) {
    throw redirect("/portal/login");
  }

  const userOrg = user.userOrganizations[0];
  if (!userOrg) {
    // User exists in shelf but isn't attached to the FabLab org — this happens
    // if they signed up via the admin /join (which creates a personal org but
    // doesn't attach them to PORTAL_ORG_ID). Send them through portal join.
    throw redirect("/portal/no-access");
  }

  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    profilePicture: user.profilePicture,
    roles: userOrg.roles,
    canSelfCheckout: canSelfCheckout(userOrg.roles),
    organizationId: orgId,
  };
}

/**
 * Make sure the portal user has a TeamMember entry inside the FabLab org.
 * Required because Booking.custodianTeamMember is non-null in shelf.
 */
export async function ensurePortalTeamMember(
  userId: string,
  organizationId: string,
  displayName: string
): Promise<string> {
  const existing = await db.teamMember.findFirst({
    where: { userId, organizationId, deletedAt: null },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await db.teamMember.create({
    data: {
      name: displayName,
      organization: { connect: { id: organizationId } },
      user: { connect: { id: userId } },
    },
    select: { id: true },
  });
  return created.id;
}

/**
 * Translates BookingStatus into the user-facing labels the design uses.
 */
export const STATUS_LABEL = {
  DRAFT: "In attesa",
  RESERVED: "Approvata",
  ONGOING: "In corso",
  OVERDUE: "In ritardo",
  COMPLETE: "Completata",
  CANCELLED: "Rifiutata",
  ARCHIVED: "Archiviata",
} as const;

/**
 * Attach an existing user to the FabLab org with SELF_SERVICE role unless they
 * already have a stronger role assigned. Idempotent — safe to call on every
 * login.
 */
export async function ensurePortalMembership(userId: string) {
  const orgId = await resolvePortalOrgId();
  await db.userOrganization.upsert({
    where: {
      userId_organizationId: {
        userId,
        organizationId: orgId,
      },
    },
    create: {
      userId,
      organizationId: orgId,
      roles: [OrganizationRoles.SELF_SERVICE],
    },
    update: {}, // never weaken an existing role
  });
  return orgId;
}

export const STATUS_TONE = {
  DRAFT: "warning",
  RESERVED: "success",
  ONGOING: "secondary",
  OVERDUE: "error",
  COMPLETE: "neutral",
  CANCELLED: "error",
  ARCHIVED: "neutral",
} as const;
