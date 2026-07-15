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
 * The write is null-guarded in BOTH directions: only null fields are placed in
 * `data` (a user's explicit choice is never overwritten), and the `updateMany`
 * WHERE clause repeats the null predicate so concurrent requests re-check the
 * committed row under Postgres row locking.
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

  // Only write the columns that are still null — never clobber a user's choice.
  const data: Prisma.UserUpdateManyMutationInput = {};
  if (currentPrefs.dateFormat === null) data.dateFormat = detected.dateFormat;
  if (currentPrefs.timeFormat === null) data.timeFormat = detected.timeFormat;
  if (currentPrefs.weekStart === null) data.weekStart = detected.weekStart;
  if (currentPrefs.timeZone === null) data.timeZone = detected.timeZone;

  // Fire-and-forget: this must never slow down or break the request it rides on.
  // updateMany (not update) lets us repeat the null-guard in the WHERE clause so
  // Postgres enforces "only the first backfill within a window wins" atomically.
  void db.user
    .updateMany({
      where: {
        id: userId,
        OR: [
          { dateFormat: null },
          { timeFormat: null },
          { weekStart: null },
          { timeZone: null },
        ],
      },
      data,
    })
    .catch((cause) => {
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
