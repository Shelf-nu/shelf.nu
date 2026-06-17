/**
 * Mobile companion usage tracking.
 *
 * Records lightweight "this user used the mobile app" activity into our own
 * database (`UserOrganization.lastMobileActiveAt`) so we can measure
 * companion-app adoption — weekly/monthly active users and organizations —
 * with no external analytics dependency.
 *
 * Recording is debounced and fire-and-forget: it stamps the timestamp at most
 * once per `ACTIVITY_DEBOUNCE_MS` per membership and never blocks or fails the
 * mobile request it rides on.
 *
 * @see {@link file://./mobile-auth.server.ts} — `requireOrganizationAccess` calls `recordMobileActivity`
 */
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";

/**
 * Minimum gap between activity writes for the same membership. Mobile clients
 * make many requests per session; "active today" only needs coarse resolution,
 * so we skip redundant writes within this window to keep each request cheap.
 */
const ACTIVITY_DEBOUNCE_MS = 60 * 60 * 1000; // 1 hour

/**
 * Record that a user is using the mobile app in a given organization, for
 * adoption metrics. Debounced and fire-and-forget — safe to call on every
 * authenticated mobile request: it never throws and never delays the response.
 *
 * The write targets the `(userId, organizationId)` composite key, so it is
 * org-scoped by construction — no cross-org write is possible regardless of
 * what the caller passes.
 *
 * @param userId - the authenticated user
 * @param organizationId - the organization the user is acting in
 * @param lastMobileActiveAt - the membership's current `lastMobileActiveAt`,
 *   passed in by the caller (which already selected it) so we debounce without
 *   an extra read
 * @returns void
 */
export function recordMobileActivity(
  userId: string,
  organizationId: string,
  lastMobileActiveAt: Date | null
): void {
  // Debounce: skip if we already recorded activity for this membership recently.
  if (
    lastMobileActiveAt &&
    Date.now() - lastMobileActiveAt.getTime() < ACTIVITY_DEBOUNCE_MS
  ) {
    return;
  }

  // Fire-and-forget: usage telemetry must never slow down or break a mobile
  // request, so we don't await it and we swallow errors (best-effort).
  void db.userOrganization
    .update({
      where: { userId_organizationId: { userId, organizationId } },
      data: { lastMobileActiveAt: new Date() },
    })
    .catch((cause) => {
      Logger.error(
        new ShelfError({
          cause,
          message: "Failed to record mobile activity",
          additionalData: { userId, organizationId },
          label: "Auth",
        })
      );
    });
}
