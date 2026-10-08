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
 * Clearing the atom on the way out is also what used to lose the
 * operator's work, so the scanned codes are mirrored into a draft that
 * outlives the page. The atom's lifecycle is unchanged: the draft sits
 * beside it, scoped to this booking, and is read back on re-entry. See
 * {@link file://./../utils/scan-draft.ts}.
 *
 * @see {@link file://./../routes/_layout+/bookings.$bookingId.overview.fulfil-and-checkout.tsx}
 * @see {@link file://./../atoms/qr-scanner.ts}
 * @see {@link file://./use-booking-checkin-session-initialization.ts}
 */

import { useEffect, useMemo, useRef } from "react";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useLocation, useNavigation } from "react-router";
import {
  type FulfilSessionInfo,
  endFulfilSessionAtom,
  scannedItemsAtom,
  setFulfilSessionAtom,
} from "~/atoms/qr-scanner";
import { useUserData } from "~/hooks/use-user-data";
import {
  clearScanDraft,
  readScanDraft,
  saveScanDraft,
  scanDraftKey,
} from "~/utils/scan-draft";

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
  const scannedItems = useAtomValue(scannedItemsAtom);
  const setScannedItems = useSetAtom(scannedItemsAtom);
  const store = useStore();

  const navigation = useNavigation();
  const location = useLocation();

  // Keyed by the signed-in user as well as the booking: this storage belongs
  // to the browser, so a shared terminal would otherwise hand one person's
  // parked list to whoever signs in next. With no user resolved there is no
  // way to keep them apart, so nothing is stored at all.
  const userId = useUserData()?.id;
  const draftKey = useMemo(
    () =>
      userId ? scanDraftKey("fulfil", userId, session.bookingId) : null,
    [userId, session.bookingId]
  );

  // Set once a submission is accepted. Rows restored from a draft resolve
  // asynchronously, so one can land after the submit has cleared the draft but
  // before the route unmounts; mirroring that would write the scans back and
  // offer work that has already gone out.
  const acceptedSubmitRef = useRef(false);

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

    // Restored entries carry no `data`, so each row resolves against the
    // server again and a list parked overnight comes back current rather than
    // describing the booking as it was.
    const draft = draftKey ? readScanDraft(draftKey) : null;
    if (draft) {
      setScannedItems(draft);
    }
  }, [session, session.bookingId, setFulfilSession, draftKey, setScannedItems]);

  // Mirror the scan list into the draft as it changes, so leaving the page by
  // any route — a tab closed, a reload, a phone asleep — keeps the work.
  useEffect(() => {
    if (initializedBookingIdRef.current !== session.bookingId) {
      return;
    }
    // Read the list from the store rather than from this render. The seeding
    // effect above writes the atom, so the render that schedules this one
    // still closes over the PRE-seed list — the empty object the clear is
    // about to produce, or whatever the last flow left behind. Saving that
    // would wipe the draft the seed is restoring from, and React's
    // development double-mount makes the loss permanent: the remount finds
    // nothing left to restore. The store always holds the current list.
    if (!draftKey || acceptedSubmitRef.current) {
      return;
    }
    saveScanDraft(draftKey, store.get(scannedItemsAtom));
  }, [scannedItems, draftKey, session.bookingId, store]);

  // A submission that navigates away is one the action accepted: these scans
  // have gone out, so the draft must not offer them again. A refused submit
  // re-renders in place without a location change and keeps its draft, which
  // is the case that most needs the list preserved.
  useEffect(() => {
    const submittedAway =
      navigation.state === "loading" &&
      navigation.formMethod?.toUpperCase() === "POST" &&
      navigation.location !== undefined &&
      navigation.location.pathname !== location.pathname;

    if (submittedAway && draftKey) {
      acceptedSubmitRef.current = true;
      clearScanDraft(draftKey);
    }
  }, [
    navigation.state,
    navigation.formMethod,
    navigation.location,
    location.pathname,
    draftKey,
  ]);

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
