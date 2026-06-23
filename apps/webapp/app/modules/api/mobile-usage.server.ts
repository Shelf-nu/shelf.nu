/**
 * Mobile companion usage tracking.
 *
 * Records lightweight "this user used the mobile app" activity into our own
 * database (`User.lastMobileActiveAt`) so we can measure companion-app adoption
 * — active users, and active accounts via a join to `UserOrganization` — with
 * no external analytics dependency.
 *
 * Recording is debounced and fire-and-forget: it stamps the timestamp at most
 * once per `ACTIVITY_DEBOUNCE_MS` per user and never blocks or fails the mobile
 * request it rides on.
 *
 * @see {@link file://./mobile-auth.server.ts} — `requireMobileAuth` calls `recordMobileActivity`
 */
import { config } from "~/config/shelf.config";
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";

/**
 * Record that a user is using the mobile app, for adoption metrics. Debounced
 * and fire-and-forget — safe to call on every authenticated mobile request: it
 * never throws and never delays the response.
 *
 * @param userId - the authenticated user (their own id, from the validated JWT)
 * @param lastMobileActiveAt - the user's current `lastMobileActiveAt`, passed in
 *   by the caller (which already selected it) so we debounce without an extra read
 * @returns void — the write is best-effort and non-blocking.
 * @throws Never — any failure is caught internally and swallowed; best-effort
 *   telemetry must not break the request it rides on.
 */
export function recordMobileActivity(
  userId: string,
  lastMobileActiveAt: Date | null
): void {
  const now = new Date();
  // Debounce window sourced from app config (no hardcoded value here).
  const cutoff = new Date(now.getTime() - config.mobileActivityDebounceMs);

  // Fast-path debounce: skip entirely if the (stale) read already shows recent
  // activity, so the common case issues no query at all.
  if (lastMobileActiveAt && lastMobileActiveAt >= cutoff) {
    return;
  }

  // Fire-and-forget: usage telemetry must never slow down or break a mobile
  // request, so we don't await it and we swallow errors (best-effort).
  // updateMany (not update) lets us repeat the debounce predicate in the where
  // clause, so the DB enforces it atomically — under Postgres row locking,
  // concurrent requests that all passed the stale fast-path check re-evaluate
  // against the committed row, so only the first write within a window succeeds.
  void db.user
    .updateMany({
      where: {
        id: userId,
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
          additionalData: { userId },
          label: "Analytics",
          // Best-effort telemetry — a failed activity write must never add
          // Sentry noise for a non-critical, optional metric.
          shouldBeCaptured: false,
        })
      );
    });
}
