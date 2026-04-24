/**
 * Booking Fulfil-and-Checkout Session Initialization Hook
 *
 * Seeds the booking fulfil-reservations drawer's Jotai atoms from
 * loader data on mount and tears them down on unmount. Mirrors the
 * partial-checkin session hook
 * (`use-booking-checkin-session-initialization.ts`) — same
 * mount/unmount discipline and bookingId-scoped guard — but targets
 * the fulfil-specific atom family (`fulfilSessionAtom`,
 * `expectedModelRequestsAtom`, plus the shared `scannedItemsAtom`
 * which `setFulfilSessionAtom` clears as a side effect).
 *
 * Mounted from the route component in
 * `bookings.$bookingId.overview.fulfil-and-checkout.tsx`, which
 * provides the session metadata via loader data.
 *
 * The cleanup is important because `scannedItemsAtom` is shared with
 * the partial-checkin drawer and the add-assets drawer — if the
 * operator switches flows without unmounting the fulfil scanner
 * cleanly, stale scans would bleed across sessions.
 *
 * @see {@link file://./../routes/_layout+/bookings.$bookingId.overview.fulfil-and-checkout.tsx}
 * @see {@link file://./../atoms/qr-scanner.ts} — see §A of the Phase
 *   3d-Polish plan for atom design rationale.
 * @see {@link file://./use-booking-checkin-session-initialization.ts}
 */

import { useEffect, useRef } from "react";
import { useSetAtom } from "jotai";
import {
  type FulfilSessionInfo,
  endFulfilSessionAtom,
  setFulfilSessionAtom,
} from "~/atoms/qr-scanner";

/**
 * Arguments for {@link useBookingFulfilSessionInitialization}.
 */
type UseBookingFulfilSessionInitializationArgs = {
  /**
   * Fulfil-and-checkout session metadata. Non-null — callers should
   * only mount this hook once the loader has confirmed the booking
   * has outstanding model requests (otherwise the loader redirects
   * to the plain checkout path). Drives `fulfilSessionAtom`, seeds
   * `expectedModelRequestsAtom`, and clears `scannedItemsAtom` on
   * mount.
   */
  session: Exclude<FulfilSessionInfo, null>;
};

/**
 * Initializes the booking fulfil-and-checkout session atoms from
 * loader data and cleans them up when the drawer unmounts.
 *
 * On mount:
 * - Dispatches `setFulfilSessionAtom` with `session` — a single write
 *   that seeds `fulfilSessionAtom`, populates
 *   `expectedModelRequestsAtom`, and clears `scannedItemsAtom` so a
 *   prior session's scans (from `scan-assets`, partial check-in, or
 *   a previous fulfil attempt) don't leak into this one.
 *
 * On unmount:
 * - Dispatches `endFulfilSessionAtom`, which clears session,
 *   expected-model-request, and scanned-items atoms in one shot.
 *   Cleanup matters because `scannedItemsAtom` is shared across the
 *   fulfil, partial-checkin, and add-assets flows.
 *
 * The seeding effect is guarded by a bookingId ref so routine
 * re-renders (with the same booking) don't redundantly dispatch the
 * setter — which would otherwise wipe in-progress scans via the
 * `scannedItemsAtom` clear baked into `setFulfilSessionAtom`.
 *
 * @param args.session - Fulfil session metadata for the atom.
 */
export function useBookingFulfilSessionInitialization(
  args: UseBookingFulfilSessionInitializationArgs
): void {
  const { session } = args;

  const setFulfilSession = useSetAtom(setFulfilSessionAtom);
  const endFulfilSession = useSetAtom(endFulfilSessionAtom);

  // Tracks which bookingId the session atom was last seeded for so we
  // don't redundantly dispatch `setFulfilSession` (which clears
  // `scannedItemsAtom`) on every render that happens to have the same
  // booking.
  const initializedBookingIdRef = useRef<string | null>(null);

  // Effect 1: seed session metadata + expected model requests. Runs
  // once per bookingId. `setFulfilSession` clears `scannedItemsAtom`
  // as a side effect, so we guard against re-running on unrelated
  // renders (e.g. parent re-render while the operator is mid-scan).
  useEffect(() => {
    if (initializedBookingIdRef.current === session.bookingId) {
      return;
    }
    initializedBookingIdRef.current = session.bookingId;
    setFulfilSession(session);
  }, [session, session.bookingId, setFulfilSession]);

  // Effect 2: cleanup on unmount (or when the bookingId changes, in
  // case the same drawer instance is reused for a different booking).
  // Guarded so we only clear atoms that this hook instance actually
  // seeded — otherwise a remount in StrictMode could stomp on a
  // freshly-mounted sibling.
  useEffect(() => {
    const currentBookingId = session.bookingId;
    return () => {
      if (initializedBookingIdRef.current === currentBookingId) {
        initializedBookingIdRef.current = null;
        endFulfilSession();
      }
    };
  }, [session.bookingId, endFulfilSession]);
}
