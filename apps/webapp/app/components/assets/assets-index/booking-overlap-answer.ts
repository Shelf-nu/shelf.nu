/**
 * Reads the "some assets are already on this booking" answer of
 * `/api/assets/add-to-booking` for the add-to-existing-booking dialog.
 *
 * The dialog keeps the server's last answer on screen while the user picks
 * another booking. An answer about booking A says nothing about booking B, so
 * everything the dialog derives from it (the list of already-added assets,
 * the "Add only the rest" control and its form flag, the assets left out of
 * the 1 unit notice) goes through {@link overlapForPickedBooking}, which
 * drops an answer that is about a different booking.
 *
 * @see {@link file://./add-assets-to-existing-booking-dialog.tsx}
 * @see {@link file://./../../../routes/api+/assets.add-to-booking.ts}
 */

/** One selected asset the booking already holds. */
export type AlreadyAddedAsset = { id: string; title: string };

/** The overlap part of the route's error `additionalData`. */
export type BookingOverlapAnswer = {
  /** The booking the answer is about. */
  bookingId: string;
  /** The selected assets that booking already holds, once each. */
  alreadyAddedAssets: AlreadyAddedAsset[];
  /** Whether the booking holds every selected asset. */
  allAssetsInBooking: boolean;
};

/**
 * The overlap answer, when it is about the booking picked right now.
 *
 * @param additionalData - The route's error `additionalData`, of any shape
 * @param pickedBookingId - The booking currently picked in the dialog
 * @returns The answer, or `null` when there is none, it lists no asset, or it
 *   is about another booking
 */
export function overlapForPickedBooking(
  additionalData: unknown,
  pickedBookingId: string | undefined
): BookingOverlapAnswer | null {
  if (!additionalData || typeof additionalData !== "object") return null;
  const answer = additionalData as Partial<BookingOverlapAnswer>;
  if (!pickedBookingId || answer.bookingId !== pickedBookingId) return null;
  if (!Array.isArray(answer.alreadyAddedAssets)) return null;
  if (answer.alreadyAddedAssets.length === 0) return null;
  return {
    bookingId: pickedBookingId,
    alreadyAddedAssets: answer.alreadyAddedAssets,
    allAssetsInBooking: answer.allAssetsInBooking === true,
  };
}

/**
 * Whether an answer is about a booking other than the one picked now, and so
 * has nothing to say about the current choice.
 *
 * @param additionalData - The route's error `additionalData`, of any shape
 * @param pickedBookingId - The booking currently picked in the dialog
 * @returns `true` only for an answer that names a different booking
 */
export function isAnswerAboutAnotherBooking(
  additionalData: unknown,
  pickedBookingId: string | undefined
): boolean {
  if (!additionalData || typeof additionalData !== "object") return false;
  const { bookingId } = additionalData as Partial<BookingOverlapAnswer>;
  return typeof bookingId === "string" && bookingId !== pickedBookingId;
}
