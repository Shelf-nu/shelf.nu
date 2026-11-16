/**
 * Drops a "Pending approval" status filter that no longer exists.
 *
 * "Pending approval" is only a status while the workspace requires approval.
 * Once both switches are off the status picker no longer offers it, so a URL
 * or saved filter that still carries it would show the picker at "All" over a
 * list (or calendar) with nothing in it. Every page that renders the bookings
 * status filter answers such a request with a redirect to the same page
 * without it: the bookings index, the calendar, and the bookings lists of an
 * asset, a kit, a team member and "My bookings".
 *
 * @see {@link file://./../../routes/_layout+/bookings._index.tsx}
 * @see {@link file://./../../routes/_layout+/calendar.tsx}
 */
import type { Organization } from "@prisma/client";
import { redirect } from "react-router";
import { db } from "~/database/db.server";
import { cleanParamsForFilterCookie } from "~/hooks/search-params";
import {
  BOOKING_APPROVAL_SWITCHES_SELECT,
  isBookingApprovalEnabled,
} from "~/utils/bookings";
import {
  createFilterCookie,
  serializeFilterCookieForUrl,
  setCookie,
} from "~/utils/cookies.server";
import { getParamsValues } from "~/utils/list";
import { PENDING_APPROVAL_BOOKINGS_FILTER } from "./constants";

/**
 * A redirect that drops a stale "Pending approval" status, or `null` when the
 * request carries no such filter or approval is still on.
 *
 * The redirect goes to the request's own path with the rest of its query, and
 * the page number goes too, since it belonged to the filtered view.
 *
 * @param args.request - The incoming request: its path and filter cookie
 * @param args.organizationId - The current workspace
 * @param args.searchParams - The request's search params
 * @param args.rewriteBookingsFilterCookie - The bookings index only: the
 *   saved bookings filter cookie (`bookingFilter_v2`) is that page's own, may
 *   still hold the stale status, and is rewritten from the cleaned query (or
 *   expired) in the same response, or the next visit would restore it and
 *   redirect back. Other pages leave it alone: their query is not a bookings
 *   index filter.
 * @returns The redirect, or `null` when nothing is stale
 */
export async function redirectFromStalePendingApprovalFilter({
  request,
  organizationId,
  searchParams,
  rewriteBookingsFilterCookie = false,
}: {
  request: Request;
  organizationId: Organization["id"];
  searchParams: URLSearchParams;
  rewriteBookingsFilterCookie?: boolean;
}): Promise<Response | null> {
  if (
    getParamsValues(searchParams).status !== PENDING_APPROVAL_BOOKINGS_FILTER
  ) {
    return null;
  }

  const approvalSettings = await db.bookingSettings.findUnique({
    where: { organizationId },
    select: BOOKING_APPROVAL_SWITCHES_SELECT,
  });
  if (isBookingApprovalEnabled(approvalSettings)) return null;

  const cleaned = new URLSearchParams(searchParams);
  cleaned.delete("status");
  cleaned.delete("page");
  const query = cleaned.toString();

  const { pathname } = new URL(request.url);
  const location = query ? `${pathname}?${query}` : pathname;
  if (!rewriteBookingsFilterCookie) return redirect(location);

  const rewrittenFilterCookie = await serializeFilterCookieForUrl(
    createFilterCookie({
      orgId: organizationId,
      name: "bookingFilter_v2",
      path: "/",
    }),
    cleanParamsForFilterCookie(query),
    request.headers.get("Cookie")
  );
  return redirect(location, {
    headers: rewrittenFilterCookie ? [setCookie(rewrittenFilterCookie)] : [],
  });
}
