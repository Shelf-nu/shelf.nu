/**
 * Seeds the Scan to Assign drawer's reservation atoms from loader data and
 * tears them down when the scanner unmounts.
 *
 * Clearing the scan list and refreshing the reservation context are split
 * across two effects because they answer to different things. `session` is a
 * fresh object on every loader revalidation, including one triggered by a
 * refused submit (the action returns `data(error(...))` and stays on the
 * page), so clearing on each one would wipe scans the operator has not yet
 * resubmitted. The reservation atoms have the opposite requirement: they
 * describe what the server currently owes, and holding them frozen lets the
 * drawer credit a scan the server will refuse.
 *
 * @see {@link file://./use-booking-fulfil-session-initialization.ts} for the
 *   Check Out equivalent. Its seed is one atomic atom write that clears the
 *   scan list as a side effect, so it cannot make this split without
 *   reshaping `setFulfilSessionAtom`, and it still refreshes only per
 *   booking.
 * @see {@link file://./../atoms/qr-scanner.ts} for `assignAlreadyIncludedAtom`
 *   and why it is kept separate from the Check Out drawer's session atom.
 */
import { useEffect, useRef } from "react";
import { useSetAtom } from "jotai";
import {
  type AlreadyIncludedRow,
  type ExpectedModelRequest,
  type ReservedModel,
  assignAlreadyIncludedAtom,
  assignReservedModelsAtom,
  expectedModelRequestsAtom,
  scannedItemsAtom,
} from "~/atoms/qr-scanner";

/**
 * Reservation context for the Scan to Assign session, or null when the
 * booking reserves no models.
 */
export type AssignSessionInfo = {
  expectedModelRequests: ExpectedModelRequest[];
  reservedModels: ReservedModel[];
  alreadyIncluded: AlreadyIncludedRow[];
} | null;

/**
 * Initializes the Scan to Assign session atoms from loader data and cleans
 * them up when the scanner unmounts.
 *
 * `scannedItemsAtom` is cleared once per `bookingId`, tracked by a ref, so a
 * prior flow's scans never surface here and an operator's in-progress scans
 * survive a revalidation for the same booking.
 *
 * `expectedModelRequestsAtom`, `assignReservedModelsAtom` and
 * `assignAlreadyIncludedAtom` follow `session` itself, emptying when it is
 * null so a booking with no reservations renders as a plain scan list. They
 * must stay current: the drawer decides from them which scans count toward a
 * reservation and which are refused as duplicates, so stale context reports
 * a claim the server will not make.
 *
 * The cleanup function reverses all four atoms so leaving the scanner does
 * not leak state into whichever flow the operator opens next.
 *
 * @param args.session - Reservation context to seed the atoms with, or null.
 * @param args.bookingId - The booking this session belongs to. Only a change
 *   here clears the scan list.
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
  const setReservedModels = useSetAtom(assignReservedModelsAtom);
  const setScannedItems = useSetAtom(scannedItemsAtom);

  // Tracks which bookingId the scan list was last cleared for, so a render
  // carrying a fresh `session` object for the same booking does not wipe
  // scans the operator is part way through.
  const initializedBookingIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (initializedBookingIdRef.current === bookingId) {
      return;
    }
    initializedBookingIdRef.current = bookingId;

    setScannedItems({});
  }, [bookingId, setScannedItems]);

  // Deliberately not guarded by the ref above: every revalidation carries
  // the server's current view of what the booking still owes, and that is
  // what the drawer classifies scans against.
  useEffect(() => {
    setExpectedModelRequests(session?.expectedModelRequests ?? []);
    setReservedModels(session?.reservedModels ?? []);
    setAlreadyIncluded(session?.alreadyIncluded ?? []);
  }, [
    session,
    setExpectedModelRequests,
    setReservedModels,
    setAlreadyIncluded,
  ]);

  useEffect(() => {
    const currentBookingId = bookingId;
    return () => {
      if (initializedBookingIdRef.current === currentBookingId) {
        initializedBookingIdRef.current = null;
        setExpectedModelRequests([]);
        setReservedModels([]);
        setAlreadyIncluded([]);
        setScannedItems({});
      }
    };
  }, [
    bookingId,
    setExpectedModelRequests,
    setReservedModels,
    setAlreadyIncluded,
    setScannedItems,
  ]);
}
