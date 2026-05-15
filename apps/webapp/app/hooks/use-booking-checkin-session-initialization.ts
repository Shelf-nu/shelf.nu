/**
 * Booking Check-in Session Initialization Hook
 *
 * Seeds the booking partial-checkin drawer's Jotai atoms from loader
 * data on mount and tears them down on unmount. Mirrors the
 * equivalent audit hook (`use-audit-session-initialization.ts`),
 * minus the audit-specific scan restoration — partial check-in has
 * no cross-session scan persistence, so `scannedItemsAtom` is left
 * alone (it's cleared as a side effect of
 * `startBookingCheckinSessionAtom`).
 *
 * Mounted from the route component in
 * `bookings.$bookingId.overview.checkin-assets.tsx`, which provides
 * the session metadata and expected-asset list via loader data.
 *
 * Re-runs its seeding effect when the booking ID or session status
 * changes, or when the expected-asset list's significant fields
 * (identity, qty-tracked `remaining`, `logged`, `booked`,
 * `alreadyCheckedIn`) change — so a loader refresh after the
 * operator submits a session (with the drawer still mounted)
 * re-syncs the atoms.
 *
 * @see {@link file://./../routes/_layout+/bookings.$bookingId.overview.checkin-assets.tsx}
 * @see {@link file://./../atoms/qr-scanner.ts}
 * @see {@link file://./use-audit-session-initialization.ts}
 */

import { useEffect, useMemo, useRef } from "react";
import { useSetAtom } from "jotai";
import {
  type BookingCheckinSessionInfo,
  type BookingExpectedAsset,
  endBookingCheckinSessionAtom,
  setBookingExpectedAssetsAtom,
  startBookingCheckinSessionAtom,
} from "~/atoms/qr-scanner";

/**
 * Arguments for {@link useBookingCheckinSessionInitialization}.
 */
type UseBookingCheckinSessionInitializationArgs = {
  /**
   * Booking-level session metadata. Non-null — callers should only
   * mount this hook once the loader has a confirmed booking in a
   * checkin-eligible state. Drives `bookingCheckinSessionAtom` and
   * clears `scannedItemsAtom` on mount.
   */
  session: Exclude<BookingCheckinSessionInfo, null>;
  /**
   * Full expected-asset list (INDIVIDUAL + QUANTITY_TRACKED) derived
   * from `booking.bookingAssets`, `qtyRemainingByAssetId`, and
   * `partialCheckinDetails` in the loader. Populates
   * `bookingExpectedAssetsAtom` so the drawer can render pending,
   * scanned, and already-reconciled buckets.
   */
  expectedAssets: BookingExpectedAsset[];
};

/**
 * Initializes the booking partial-checkin session atoms from loader
 * data and cleans them up when the drawer unmounts.
 *
 * On mount:
 * - Dispatches `startBookingCheckinSessionAtom` with `session` (this
 *   also clears `scannedItemsAtom` to prevent bleed-through from a
 *   prior session).
 * - Dispatches `setBookingExpectedAssetsAtom` with `expectedAssets`.
 *
 * On unmount:
 * - Dispatches `endBookingCheckinSessionAtom`, which clears session,
 *   expected-asset, and scanned-items atoms in one shot.
 *
 * The seeding effect re-runs on `session.bookingId` + `session.status`
 * changes, and separately on a memoized signature of the expected
 * assets (so a loader refresh — e.g. after the operator submits a
 * partial session and the drawer stays mounted — re-syncs the atoms
 * without thrashing on every render).
 *
 * Intentionally does NOT hydrate `scannedItemsAtom`: partial check-in
 * has no cross-session scan persistence, unlike audits.
 *
 * @param args.session - Booking-level session metadata for the atom.
 * @param args.expectedAssets - Full expected-asset list for the drawer.
 */
export function useBookingCheckinSessionInitialization(
  args: UseBookingCheckinSessionInitializationArgs
): void {
  const { session, expectedAssets } = args;

  const startSession = useSetAtom(startBookingCheckinSessionAtom);
  const setExpectedAssets = useSetAtom(setBookingExpectedAssetsAtom);
  const endSession = useSetAtom(endBookingCheckinSessionAtom);

  // Tracks which bookingId the session atom was last seeded for so we
  // don't redundantly dispatch `startSession` (which clears
  // `scannedItemsAtom`) on every render that happens to have the same
  // booking.
  const initializedBookingIdRef = useRef<string | null>(null);

  /**
   * Stable signature of the fields that meaningfully affect the
   * expected-asset list. Used as a dependency so the second effect
   * re-seeds `bookingExpectedAssetsAtom` when a loader refresh
   * returns updated `remaining`/`logged` counts — but NOT on every
   * render (which would be the case if we depended on
   * `expectedAssets` directly, since Remix gives us a new array
   * reference on each loader call).
   */
  const expectedAssetsSignature = useMemo(
    () =>
      JSON.stringify(
        expectedAssets.map((asset) =>
          asset.kind === "INDIVIDUAL"
            ? {
                k: "I",
                id: asset.id,
                c: asset.alreadyCheckedIn,
                ki: asset.kitId ?? null,
              }
            : {
                k: "Q",
                id: asset.id,
                b: asset.booked,
                l: asset.logged,
                r: asset.remaining,
                ct: asset.consumptionType,
                ki: asset.kitId ?? null,
              }
        )
      ),
    [expectedAssets]
  );

  // Effect 1: seed session metadata. Runs once per bookingId (or when
  // status flips — e.g. ONGOING → OVERDUE — which the drawer header
  // reads). `startSession` clears `scannedItemsAtom`, so we guard
  // against re-running on unrelated renders.
  useEffect(() => {
    if (initializedBookingIdRef.current === session.bookingId) {
      return;
    }
    initializedBookingIdRef.current = session.bookingId;
    startSession(session);
  }, [session, session.bookingId, session.status, startSession]);

  // Effect 2: seed expected assets. Runs on initial mount and again
  // whenever the signature changes (loader refresh after a submit).
  // Cheap operation — just swaps the atom value.
  useEffect(() => {
    setExpectedAssets(expectedAssets);
    // `expectedAssets` intentionally omitted from deps — we use the
    // memoized signature to avoid re-running on every loader call
    // that returns a structurally-equivalent array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expectedAssetsSignature, setExpectedAssets]);

  // Effect 3: cleanup on unmount (or when the bookingId changes, in
  // case the same drawer instance is reused for a different booking).
  useEffect(() => {
    const currentBookingId = session.bookingId;
    return () => {
      if (initializedBookingIdRef.current === currentBookingId) {
        initializedBookingIdRef.current = null;
        endSession();
      }
    };
  }, [session.bookingId, endSession]);
}
