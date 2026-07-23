/**
 * User formatting-preference lazy backfill.
 *
 * Pre-existing users predate the date/time-formatting feature and have `null`
 * formatting columns. On any authenticated request (the root loader is the
 * chokepoint) we snapshot the browser-hint-detected values into the still-`null`
 * fields, once, fire-and-forget — mirroring the debounced `lastMobileActiveAt`
 * write in `recordMobileActivity`. New users are written concretely at creation
 * (Phase 4) and never reach this path.
 *
 * Each still-null column is written by its OWN null-guarded `updateMany`: a
 * user's explicit choice is never overwritten because the per-field WHERE
 * re-checks that specific column under Postgres row locking, so a value made
 * concrete by a concurrent request (after our read, before our write) matches
 * zero rows and is left untouched. (A single combined write was racy — see the
 * inline note in {@link detectAndPersistFormatPrefs}.)
 *
 * @see {@link file://../api/mobile-usage.server.ts} recordMobileActivity — the pattern this mirrors
 * @see {@link file://../../root.tsx} — root loader calls this on null-bearing users
 */
import type { Prisma } from "@prisma/client";

import { db } from "~/database/db.server";
import type { ClientHint } from "~/utils/client-hints";
import type { RawFormatPrefs } from "~/utils/date-format";
import { detectFormatPrefsFromHints } from "~/utils/date-format";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";

/**
 * Detect and persist a pre-existing user's formatting prefs from browser hints,
 * filling only the columns that are still `null`. Fire-and-forget: never awaited,
 * never throws, safe to call on every authenticated request.
 *
 * @param userId - The authenticated (acting) user.
 * @param currentPrefs - The user's four raw pref columns as just read.
 * @param hints - The request's browser hints (locale + timezone).
 * @returns void — best-effort, non-blocking.
 * @throws Never — any failure is caught and logged (uncaptured telemetry).
 */
export function detectAndPersistFormatPrefs(
  userId: string,
  currentPrefs: RawFormatPrefs,
  hints: ClientHint
): void {
  // Fast-path: nothing to backfill if every field is already concrete.
  if (
    currentPrefs.dateFormat !== null &&
    currentPrefs.timeFormat !== null &&
    currentPrefs.weekStart !== null &&
    currentPrefs.timeZone !== null
  ) {
    return;
  }

  const detected = detectFormatPrefsFromHints(hints);

  // Backfill each still-null column with its OWN null-guarded updateMany rather
  // than one write covering every read-time-null column. The single-write form
  // was racy: its `data` snapshot is built from a possibly-stale read, while a
  // combined WHERE only required *any* column to be null — so a preference the
  // user explicitly set on a concurrent request (after our read, before our
  // write) would be overwritten by the stale detected value as long as some
  // OTHER column was still null. Per-field writes close that gap: each WHERE
  // re-checks its own column under Postgres row locking, so a column made
  // concrete since our read matches zero rows and is left untouched. Only the
  // columns that were null at read time are even attempted (the outer guards).
  const writes: Prisma.PrismaPromise<Prisma.BatchPayload>[] = [];
  if (currentPrefs.dateFormat === null) {
    writes.push(
      db.user.updateMany({
        where: { id: userId, dateFormat: null },
        data: { dateFormat: detected.dateFormat },
      })
    );
  }
  if (currentPrefs.timeFormat === null) {
    writes.push(
      db.user.updateMany({
        where: { id: userId, timeFormat: null },
        data: { timeFormat: detected.timeFormat },
      })
    );
  }
  if (currentPrefs.weekStart === null) {
    writes.push(
      db.user.updateMany({
        where: { id: userId, weekStart: null },
        data: { weekStart: detected.weekStart },
      })
    );
  }
  if (currentPrefs.timeZone === null) {
    writes.push(
      db.user.updateMany({
        where: { id: userId, timeZone: null },
        data: { timeZone: detected.timeZone },
      })
    );
  }

  // Fire-and-forget: this must never slow down or break the request it rides on.
  void Promise.all(writes).catch((cause) => {
    Logger.error(
      new ShelfError({
        cause,
        message: "Failed to backfill user format preferences",
        additionalData: { userId },
        label: "User",
        // Best-effort backfill — a failed write must never add Sentry noise;
        // the user simply resolves from live hints until the next load retries.
        shouldBeCaptured: false,
      })
    );
  });
}
