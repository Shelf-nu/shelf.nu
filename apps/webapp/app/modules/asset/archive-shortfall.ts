/**
 * Archive Model-Reservation Shortfall
 *
 * Archiving an asset takes one unit out of its model's pool. A booking that
 * reserved units of that model by name-less "model request" can then be left
 * promised more than the pool holds (issue #382). Archiving still goes ahead
 * if the user confirms: the server refuses the first attempt with a message
 * built here, the UI recognises it, warns, and resubmits with
 * `confirmModelShortfall`.
 *
 * Pure and client-safe, so the server that builds the message and the UI that
 * recognises it share one definition and cannot drift.
 *
 * @see {@link file://./service.server.ts} — `archiveAsset`, `bulkArchiveAssets`
 * @see {@link file://./../booking-model-request/service.server.ts} — `findModelReservationsShortAfterArchive`
 */

/** One booking whose model reservation would no longer fit. */
export type ModelReservationShortfall = {
  bookingId: string;
  bookingName: string;
  modelName: string;
  /** Units the booking would be promised beyond what the pool holds. */
  short: number;
};

/** The form field that confirms an archive despite a shortfall. */
export const CONFIRM_MODEL_SHORTFALL_FIELD = "confirmModelShortfall";

/** Opening words every shortfall warning starts with; what the UI keys on. */
const MESSAGE_PREFIX = "Archiving would leave model reservations short";

/**
 * Builds the warning the server returns for an unconfirmed archive.
 *
 * @param shortfalls - Every booking left short, at least one
 * @returns A sentence naming each booking, model and the units it would lack
 */
export function formatModelShortfallMessage(
  shortfalls: ModelReservationShortfall[]
): string {
  const parts = shortfalls.map(
    (s) =>
      `"${s.bookingName}" (${s.short} ${s.modelName} unit${
        s.short === 1 ? "" : "s"
      } short)`
  );
  return `${MESSAGE_PREFIX}: ${parts.join(
    ", "
  )}. Those bookings will be refused at reservation or check-out unless their model reservations are reduced. Archive anyway?`;
}

/**
 * Whether an error message is the shortfall warning, so the UI can offer
 * "Archive anyway" instead of showing a plain failure.
 *
 * @param message - The error message from the archive action
 */
export function isModelShortfallMessage(
  message: string | null | undefined
): boolean {
  return Boolean(message?.startsWith(MESSAGE_PREFIX));
}
