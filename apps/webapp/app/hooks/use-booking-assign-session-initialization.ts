/**
 * Seeds the Scan to Assign drawer's reservation atoms from loader data and
 * tears them down when the scanner unmounts.
 *
 * The seed is guarded by a `bookingId` ref rather than re-running on every
 * `session` identity change: `session` is a fresh object on every loader
 * revalidation, including one triggered by a refused submit (the action
 * returns `data(error(...))` and stays on the page). Re-seeding on that
 * revalidation would clear `scannedItemsAtom` and wipe scans the operator
 * has not yet resubmitted.
 *
 * @see {@link file://./use-booking-fulfil-session-initialization.ts} for the
 *   Check Out equivalent this mirrors, including the same guard.
 * @see {@link file://./../atoms/qr-scanner.ts} for `assignAlreadyIncludedAtom`
 *   and why it is kept separate from the Check Out drawer's session atom.
 */
import { useEffect, useRef } from "react";
import { useSetAtom } from "jotai";
import {
  type AlreadyIncludedRow,
  type ExpectedModelRequest,
  assignAlreadyIncludedAtom,
  expectedModelRequestsAtom,
  scannedItemsAtom,
} from "~/atoms/qr-scanner";

/**
 * Reservation context for the Scan to Assign session, or null when the
 * booking reserves no models.
 */
export type AssignSessionInfo = {
  expectedModelRequests: ExpectedModelRequest[];
  alreadyIncluded: AlreadyIncludedRow[];
} | null;

/**
 * Initializes the Scan to Assign session atoms from loader data and cleans
 * them up when the scanner unmounts.
 *
 * Seeds `expectedModelRequestsAtom` and `assignAlreadyIncludedAtom` from
 * `session` (or empties both when `session` is null, so a booking with no
 * reservations renders exactly as the screen always has) and clears
 * `scannedItemsAtom` so a prior flow's scans never surface here. That seed
 * runs once per `bookingId`, tracked by a ref: a loader revalidation for the
 * SAME booking (a refused submit, a background refetch) updates neither the
 * progress atoms nor the scan list, so an operator's in-progress scans
 * survive a submit the server rejected. The cleanup function reverses all
 * three atoms so leaving the scanner does not leak state into whichever flow
 * the operator opens next.
 *
 * @param args.session - Reservation context to seed the atoms with, or null.
 * @param args.bookingId - The booking this session belongs to. Re-seeds only
 *   when this changes, never on a same-booking revalidation.
 */
export function useBookingAssignSessionInitialization({
  session,
  bookingId,
}: {
  session: AssignSessionInfo;
  bookingId: string;
}): void {
  const setExpectedModelRequests = useSetAtom(expectedModelRequestsAtom);
  const setAlreadyIncluded = useSetAtom(assignAlreadyIncludedAtom);
  const setScannedItems = useSetAtom(scannedItemsAtom);

  // Tracks which bookingId the atoms were last seeded for, so a render
  // carrying a fresh `session` object for the same booking does not
  // re-trigger the seed (and the `scannedItemsAtom` clear it carries).
  const initializedBookingIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (initializedBookingIdRef.current === bookingId) {
      return;
    }
    initializedBookingIdRef.current = bookingId;

    setScannedItems({});
    setExpectedModelRequests(session?.expectedModelRequests ?? []);
    setAlreadyIncluded(session?.alreadyIncluded ?? []);
  }, [
    bookingId,
    session,
    setExpectedModelRequests,
    setAlreadyIncluded,
    setScannedItems,
  ]);

  useEffect(() => {
    const currentBookingId = bookingId;
    return () => {
      if (initializedBookingIdRef.current === currentBookingId) {
        initializedBookingIdRef.current = null;
        setExpectedModelRequests([]);
        setAlreadyIncluded([]);
        setScannedItems({});
      }
    };
  }, [
    bookingId,
    setExpectedModelRequests,
    setAlreadyIncluded,
    setScannedItems,
  ]);
}
