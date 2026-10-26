/**
 * Model reservations a booking's dates can no longer fill.
 *
 * A booking can reserve N units of a model without naming them. The pool can
 * shrink after the reservation was made, for example when a unit of the model
 * is archived with "Archive anyway", and the booking is then promised more
 * units than its dates can get. The server measures that while units can
 * still be assigned and sends it as `booking.modelReservationShortfalls`; the
 * booking screen warns once above the reservations and marks each short row.
 *
 * MIRROR of the wording in
 * `apps/webapp/app/components/booking/booking-model-reservations-section.tsx`
 * (the notice under the section header and `ShortfallChip`). Cosmetic only:
 * the server refuses an assignment the pool cannot fill. Extraction target:
 * `@shelf/labels`.
 *
 * This module must stay free of React Native, Expo and `@/` imports: its test
 * runs under Node's test runner.
 *
 * @see ./model-reservation-shortfall.test.ts
 * @see {@link file://./../app/(tabs)/bookings/[id].tsx} the consumer
 */

/** The part of a shortfall the wording reads. */
type ShortfallCounts = {
  /** Units the reservation is promised beyond what the pool holds. */
  short: number;
  /** Units the booking can still get for its dates. */
  available: number;
};

/** The sentence under "Reserved models" when any reservation is short. */
export const MODEL_SHORTFALL_NOTICE =
  "Not enough units are free for this booking's dates. Reduce the reservation to what can be assigned.";

/**
 * How far one reservation is short, for the chip on its row.
 *
 * @param shortfall - The row's shortfall
 * @returns "2 short: only 1 free", or "2 short: none free"
 */
export function modelShortfallLabel({
  short,
  available,
}: ShortfallCounts): string {
  return available > 0
    ? `${short} short: only ${available} free`
    : `${short} short: none free`;
}

/**
 * The shortfalls keyed by model, so each reservation row finds its own.
 *
 * @param shortfalls - `booking.modelReservationShortfalls`; absent from
 *   servers that predate it, and then read as none
 * @returns A map from model id to that model's shortfall
 */
export function shortfallsByModelId<T extends { assetModelId: string }>(
  shortfalls: readonly T[] | undefined
): Map<string, T> {
  return new Map((shortfalls ?? []).map((s) => [s.assetModelId, s]));
}
