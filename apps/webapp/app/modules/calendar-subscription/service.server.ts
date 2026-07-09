/**
 * Calendar subscription service.
 *
 * Manages the per-member-per-workspace secret token that powers the
 * subscribable iCal booking feed, and resolves a token back to the member plus
 * the visibility flags needed to scope the feed like the in-app calendar.
 *
 * The token lives on `UserOrganization.calendarTokenId` (the exact
 * member↔workspace grain), so a single lookup yields userId + organizationId +
 * roles and there is no separate model to maintain.
 *
 * @see {@link file://./../../routes/api+/calendar.feed.$token[.ics].ts}
 * @see {@link file://./../../routes/_layout+/calendar.tsx}
 */
import { randomBytes } from "node:crypto";
import { OrganizationRoles } from "@prisma/client";
import { db } from "~/database/db.server";
import { SERVER_URL } from "~/utils/env";
import { ShelfError } from "~/utils/error";
import {
  assertCanUseBookings,
  canUseBookings,
} from "~/utils/subscription.server";

/** Bytes of entropy for a feed token (192 bits → 32-char base64url string). */
const CALENDAR_TOKEN_BYTES = 24;

/** Generates a fresh, unguessable, URL-safe feed token. */
function generateCalendarToken(): string {
  return randomBytes(CALENDAR_TOKEN_BYTES).toString("base64url");
}

/** Identifies a member within a workspace. */
type MembershipArgs = { userId: string; organizationId: string };

/**
 * Returns the member's existing feed token, generating one on first use.
 *
 * @throws {ShelfError} If the user is not a member of the workspace
 */
export async function getOrCreateCalendarToken({
  userId,
  organizationId,
}: MembershipArgs): Promise<string> {
  const membership = await db.userOrganization.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    select: { calendarTokenId: true },
  });

  if (!membership) {
    throw new ShelfError({
      cause: null,
      title: "Not a member",
      message: "You are not a member of this workspace.",
      status: 403,
      label: "Booking",
    });
  }

  if (membership.calendarTokenId) {
    return membership.calendarTokenId;
  }

  return rotateCalendarToken({ userId, organizationId });
}

/**
 * Rotates (or first-sets) the member's feed token, invalidating any
 * previously-shared subscription URL.
 *
 * @returns The new token
 */
export async function rotateCalendarToken({
  userId,
  organizationId,
}: MembershipArgs): Promise<string> {
  const calendarTokenId = generateCalendarToken();
  await db.userOrganization.update({
    where: { userId_organizationId: { userId, organizationId } },
    data: { calendarTokenId },
  });
  return calendarTokenId;
}

/** Revokes the member's feed token; existing subscriptions stop updating. */
export async function revokeCalendarToken({
  userId,
  organizationId,
}: MembershipArgs): Promise<void> {
  await db.userOrganization.update({
    where: { userId_organizationId: { userId, organizationId } },
    data: { calendarTokenId: null },
  });
}

/** Builds the absolute, subscribable feed URL for a token. */
export function buildCalendarFeedUrl(token: string): string {
  return `${SERVER_URL}/api/calendar/feed/${token}.ics`;
}

/**
 * Returns the member's current feed URL, or `null` if they haven't generated
 * one yet. Used by the `/calendar` loader to seed the Subscribe dialog.
 */
export async function getMemberCalendarFeedUrl({
  userId,
  organizationId,
}: MembershipArgs): Promise<string | null> {
  const membership = await db.userOrganization.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    select: { calendarTokenId: true },
  });
  return membership?.calendarTokenId
    ? buildCalendarFeedUrl(membership.calendarTokenId)
    : null;
}

/**
 * Asserts the caller may manage a specific workspace's calendar feed: they must
 * be a member of it AND the workspace must be entitled to bookings. Guards the
 * action against a user-supplied organizationId being used to mint/revoke a
 * token in a workspace the caller doesn't belong to (cross-org IDOR).
 *
 * @throws {ShelfError} 403 when the user is not a member of the workspace
 * @throws {ShelfError} when the workspace cannot use bookings
 */
export async function assertMemberCanManageCalendar({
  userId,
  organizationId,
}: MembershipArgs): Promise<void> {
  const membership = await db.userOrganization.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    select: { organization: { select: { type: true } } },
  });

  if (!membership) {
    throw new ShelfError({
      cause: null,
      title: "Not a member",
      message: "You are not a member of this workspace.",
      status: 403,
      label: "Booking",
    });
  }

  assertCanUseBookings(membership.organization);
}

/** One workspace's calendar-feed summary for the Calendars settings tab. */
export type MemberCalendarFeed = {
  organizationId: string;
  name: string;
  role: OrganizationRoles;
  /** Absolute feed URL, or null when the member hasn't generated one yet. */
  feedUrl: string | null;
};

/**
 * Lists the member's workspaces that can have a booking calendar, each with its
 * current feed URL (or null). Excludes an SSO user's personal workspace and any
 * workspace not entitled to bookings, so the settings tab shows no dead rows.
 */
export async function getMemberCalendarFeeds({
  userId,
}: {
  userId: string;
}): Promise<MemberCalendarFeed[]> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      sso: true,
      userOrganizations: {
        select: {
          roles: true,
          calendarTokenId: true,
          organization: { select: { id: true, name: true, type: true } },
        },
      },
    },
  });

  if (!user) return [];

  return (
    user.userOrganizations
      .filter((m) => {
        // SSO users never see their personal workspace.
        if (user.sso && m.organization.type === "PERSONAL") return false;
        // Only workspaces entitled to bookings can have a feed.
        return canUseBookings(m.organization);
      })
      .map((m) => ({
        organizationId: m.organization.id,
        name: m.organization.name,
        role: m.roles[0] ?? OrganizationRoles.BASE,
        feedUrl: m.calendarTokenId
          ? buildCalendarFeedUrl(m.calendarTokenId)
          : null,
      }))
      // Stable alphabetical order by workspace name so the list never reshuffles.
      // The underlying UserOrganization order follows updatedAt, which changes
      // when a member generates/rotates a token — jarring to watch rows jump.
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
      )
  );
}

/**
 * Resolves a secret feed token to its member + the org visibility settings
 * needed to scope bookings. Returns `null` for an unknown/revoked token, or for
 * a workspace no longer entitled to Bookings — the route renders a clean 404 in
 * every case.
 */
export async function getCalendarFeedContext(token: string) {
  const membership = await db.userOrganization.findUnique({
    where: { calendarTokenId: token },
    select: {
      userId: true,
      organizationId: true,
      roles: true,
      organization: {
        select: {
          name: true,
          type: true,
          selfServiceCanSeeBookings: true,
          baseUserCanSeeBookings: true,
          selfServiceCanSeeCustody: true,
          baseUserCanSeeCustody: true,
        },
      },
    },
  });

  // Entitlement gate: bookings (and their feed) are a Team-workspace feature.
  // A workspace that generated a token while eligible and later became
  // ineligible (e.g. downgraded from Team) must stop serving the feed. The
  // public feed route is cookie-bypassed, so this is the only place the check
  // can live — the route treats null identically to an unknown/revoked token.
  if (!membership || !canUseBookings(membership.organization)) {
    return null;
  }

  return membership;
}

/** Resolved feed context for a valid token (non-null result of the lookup). */
export type CalendarFeedContext = NonNullable<
  Awaited<ReturnType<typeof getCalendarFeedContext>>
>;

/**
 * Derives booking + custody visibility from a member's role and workspace
 * settings. Mirrors the logic in `requirePermission` (roles.server.ts) so the
 * feed shows exactly what the member sees in the in-app calendar.
 *
 * @returns `canSeeAllBookings` (whole workspace vs. own only) and
 *   `canSeeAllCustody` (whether custodian names may be shown)
 */
export function resolveCalendarVisibility({
  roles,
  organization,
}: {
  roles: OrganizationRoles[];
  organization: {
    selfServiceCanSeeBookings: boolean;
    baseUserCanSeeBookings: boolean;
    selfServiceCanSeeCustody: boolean;
    baseUserCanSeeCustody: boolean;
  };
}): { canSeeAllBookings: boolean; canSeeAllCustody: boolean } {
  const role = roles[0] ?? OrganizationRoles.BASE;
  const isSelfServiceOrBase =
    role === OrganizationRoles.SELF_SERVICE || role === OrganizationRoles.BASE;

  const canSeeAllBookings =
    !isSelfServiceOrBase ||
    (role === OrganizationRoles.SELF_SERVICE &&
      organization.selfServiceCanSeeBookings) ||
    (role === OrganizationRoles.BASE && organization.baseUserCanSeeBookings);

  const canSeeAllCustody =
    !isSelfServiceOrBase ||
    (role === OrganizationRoles.SELF_SERVICE &&
      organization.selfServiceCanSeeCustody) ||
    (role === OrganizationRoles.BASE && organization.baseUserCanSeeCustody);

  return { canSeeAllBookings, canSeeAllCustody };
}
