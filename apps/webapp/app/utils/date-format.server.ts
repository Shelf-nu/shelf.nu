/**
 * Server-side date-format resolution seam.
 *
 * Fetches a user's four raw formatting-preference columns and resolves them
 * (against optional request hints) into a fully-concrete {@link ResolvedFormatPrefs}
 * via the same pure resolver the client uses. This is the userId-only entry point
 * for server surfaces that render dates for a specific user — CSV exports and PDFs
 * (acting user) and emails (recipient user) — and is also the sibling of the
 * root loader's inline read.
 *
 * @see {@link file://./date-format.ts} resolveFormatPrefs — the pure resolver
 * @see {@link file://../root.tsx} — root loader resolves the acting user's prefs
 */
import { db } from "~/database/db.server";
import type { ClientHint } from "~/utils/client-hints";
import type { RawFormatPrefs, ResolvedFormatPrefs } from "~/utils/date-format";
import {
  HARDCODED_DEFAULT_PREFS,
  resolveFormatPrefs,
} from "~/utils/date-format";

/**
 * Minimal Prisma surface `resolveUserFormatPrefsById` needs. Both the extended
 * top-level client and an interactive transaction client satisfy this shape, so
 * callers can pass either — the same structural-typing approach used by
 * `RecordEventTxClient` (extended-client vs generated-tx are not directly
 * assignable, but both match this narrow shape).
 */
type PrismaTxClient = {
  user: {
    findFirst: (args: {
      where: { id: string };
      select: {
        dateFormat: true;
        timeFormat: true;
        weekStart: true;
        timeZone: true;
      };
    }) => Promise<RawFormatPrefs | null>;
  };
};

/**
 * Fetch a user's raw formatting prefs and resolve them into concrete prefs.
 *
 * In steady state the four columns are concrete (written at user creation), so
 * `hints` is unused; a still-`null` field (pre-existing user not yet lazily
 * backfilled) falls back to `detectFormatPrefsFromHints(hints)` when hints are
 * supplied, else to `HARDCODED_DEFAULT_PREFS`. A missing user row resolves as
 * all-null (→ hints, else defaults).
 *
 * @param userId - The user whose prefs to resolve (acting user for exports/PDFs;
 *   recipient for emails).
 * @param hints - Request browser hints when request-scoped (loaders), else null.
 * @param tx - Optional Prisma transaction client so the read joins a caller's tx.
 * @returns Fully-concrete resolved formatting prefs.
 */
export async function resolveUserFormatPrefsById(
  userId: string,
  hints: ClientHint | null,
  tx?: PrismaTxClient
): Promise<ResolvedFormatPrefs> {
  const client: PrismaTxClient = tx ?? db;

  const userPrefs = await client.user.findFirst({
    where: { id: userId },
    select: {
      dateFormat: true,
      timeFormat: true,
      weekStart: true,
      timeZone: true,
    },
  });

  return resolveFormatPrefs(userPrefs, hints);
}

/**
 * Prefs whose zone is the one a client DECLARED it encoded its wall-clock in.
 *
 * A `datetime-local`-style wire string (`"2026-08-20T09:00"`) carries no offset,
 * so it only means something paired with the zone it was written in. Decoding it
 * in any other zone yields a different instant — an encoding error, not a
 * preference disagreement.
 *
 * The companion serialises picked dates from DEVICE-local components
 * (`toLocalWire` in `apps/companion/app/(tabs)/bookings/new.tsx`) and declares
 * that zone in the request body, deliberately rendering its picker device-local
 * to match. So the mobile booking routes must decode in the declared zone, NOT
 * in the user's stored preference zone. Doing otherwise shifts the stored
 * instant, and — because the edit screen re-submits what it rendered — shifts it
 * again on every save.
 *
 * Web needs no equivalent: its forms seed the input from the preference zone
 * (`toIsoDateTimeToUserTimezone(booking.from, prefs.timeZone)`), so there the
 * declared zone and the preference zone are the same thing, and
 * {@link resolveUserFormatPrefsById} is the right source.
 *
 * Only `timeZone` is read by the booking schemas; the remaining fields come from
 * {@link HARDCODED_DEFAULT_PREFS} and are never used for parsing. This exists as
 * a named helper rather than an inline object so the exception is greppable and
 * explained once — `BookingFormSchemaParams.prefs` is typed
 * {@link ResolvedFormatPrefs} precisely to stop a non-preference zone being
 * passed by accident.
 *
 * @param timeZone - The IANA zone the client declared, already validated by the
 *   route's Zod schema (`isValidTimeZone`).
 * @returns Concrete prefs carrying the declared zone.
 */
export function prefsForDeclaredZone(timeZone: string): ResolvedFormatPrefs {
  return { ...HARDCODED_DEFAULT_PREFS, timeZone };
}
