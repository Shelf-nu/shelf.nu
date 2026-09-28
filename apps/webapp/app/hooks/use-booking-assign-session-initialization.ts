/**
 * Seeds the Scan to Assign drawer's reservation atoms from loader data and
 * tears them down when the scanner unmounts.
 *
 * The teardown is the reason this is a hook rather than a render-time write:
 * `scannedItemsAtom` is shared with the fulfil, partial check-in and
 * add-assets drawers, so scans left behind bleed into whichever flow the
 * operator opens next.
 *
 * @see {@link file://./use-booking-fulfil-session-initialization.ts} for the
 *   Check Out equivalent, which owns its own session atom as well.
 * @see {@link file://./../atoms/qr-scanner.ts} for `assignAlreadyIncludedAtom`
 *   and why it is kept separate from the Check Out drawer's session atom.
 */
import { useEffect } from "react";
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
 * Runs on every mount and every time `session` changes identity: it clears
 * `scannedItemsAtom` so a prior flow's scans never surface here, then seeds
 * `expectedModelRequestsAtom` and `assignAlreadyIncludedAtom` from `session`
 * (or empties both when `session` is null, so a booking with no reservations
 * renders exactly as the screen always has). The cleanup function reverses
 * all three so leaving the scanner does not leak state into whichever flow
 * the operator opens next.
 *
 * @param args.session - Reservation context to seed the atoms with, or null.
 */
export function useBookingAssignSessionInitialization({
  session,
}: {
  session: AssignSessionInfo;
}): void {
  const setExpectedModelRequests = useSetAtom(expectedModelRequestsAtom);
  const setAlreadyIncluded = useSetAtom(assignAlreadyIncludedAtom);
  const setScannedItems = useSetAtom(scannedItemsAtom);

  useEffect(() => {
    // A booking with no reservations still clears the scan list on mount, so
    // the previous flow's scans never show up under this one.
    setScannedItems({});
    setExpectedModelRequests(session?.expectedModelRequests ?? []);
    setAlreadyIncluded(session?.alreadyIncluded ?? []);

    return () => {
      setExpectedModelRequests([]);
      setAlreadyIncluded([]);
      setScannedItems({});
    };
  }, [session, setExpectedModelRequests, setAlreadyIncluded, setScannedItems]);
}
