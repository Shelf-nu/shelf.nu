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
 * The write uses `updateMany` filtered on `(userId, organizationId)` (a unique
 * pair), so it is org-scoped by construction — no cross-org write is possible —
 * and it is a no-op rather than an error if the membership was removed between
 * the caller's read and this write.
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
  const now = new Date();
  const cutoff = new Date(now.getTime() - ACTIVITY_DEBOUNCE_MS);

  // Fast-path debounce: skip entirely if the (stale) read already shows recent
  // activity, so the common case issues no query at all.
  if (lastMobileActiveAt && lastMobileActiveAt >= cutoff) {
    return;
  }

  // Fire-and-forget: usage telemetry must never slow down or break a mobile
  // request, so we don't await it and we swallow errors (best-effort).
  // updateMany (not update) so a membership removed between read and write is a
  // silent no-op instead of a thrown P2025. The debounce predicate is repeated
  // in the where clause so the DB enforces it atomically — under Postgres row
  // locking, concurrent requests that all passed the stale fast-path check
  // re-evaluate against the committed row, so only the first write within a
  // window succeeds.
  void db.userOrganization
    .updateMany({
      where: {
        userId,
        organizationId,
        OR: [
          { lastMobileActiveAt: null },
          { lastMobileActiveAt: { lt: cutoff } },
        ],
      },
      data: { lastMobileActiveAt: now },
    })
    .catch((cause) => {
      Logger.error(
        new ShelfError({
          cause,
          message: "Failed to record mobile activity",
          additionalData: { userId, organizationId },
          label: "Analytics",
          // Best-effort telemetry — a failed activity write must never add
          // Sentry noise for a non-critical, optional metric.
          shouldBeCaptured: false,
        })
      );
    });
}
