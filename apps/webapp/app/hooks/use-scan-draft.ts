/**
 * Mirrors a scanner's list into a draft that outlives the page.
 *
 * `scannedItemsAtom` lives in React memory, and every scanner clears it on the
 * way in and on the way out so one flow's scans never reach the next. That
 * also means a reload, a closed tab or an error page takes the operator's
 * scans with it. This hook keeps a copy of the scanned codes beside the atom,
 * scoped to one flow, one target and one person, and hands the flow's session
 * hook a way to read it back on entry.
 *
 * The atom's lifecycle stays with the session hook that calls this one: that
 * hook decides when the list is cleared, and calls `restoreDraft` straight
 * after its entry clear.
 *
 * @see {@link file://./../utils/scan-draft.ts} for what a draft holds.
 * @see {@link file://./use-booking-fulfil-session-initialization.ts}
 * @see {@link file://./use-booking-assign-session-initialization.ts}
 * @see {@link file://./use-booking-checkin-session-initialization.ts}
 */
import type { RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useLocation, useNavigation } from "react-router";
import { scannedItemsAtom } from "~/atoms/qr-scanner";
import { useUserData } from "~/hooks/use-user-data";
import {
  clearScanDraft,
  readScanDraft,
  readScanDraftContext,
  saveScanDraft,
  saveScanDraftContext,
  scanDraftKey,
} from "~/utils/scan-draft";

/** Arguments for {@link useScanDraft}. */
type UseScanDraftArgs = {
  /**
   * The flow, e.g. `"fulfil"`. Distinct per scanner, so two scanners open on
   * the same target never read each other's list.
   */
  scope: string;
  /** What is being scanned into: a booking, a kit, a location. */
  targetId: string;
  /**
   * The target the calling session hook last seeded its atoms for, or `null`
   * before it has. Nothing is mirrored until this matches `targetId`: before
   * that the atom still holds whatever the previous flow left behind.
   */
  seededTargetIdRef: RefObject<string | null>;
};

/**
 * Keeps a draft of the scan list for one flow on one target.
 *
 * - Mirrors `scannedItemsAtom` into the draft as it changes, once the caller
 *   has seeded its session. An emptied list removes the draft.
 * - Removes the draft when a submission is accepted, which is the one that
 *   navigates away. A submission that stays on the page (refused, or never
 *   answered) keeps its draft.
 *
 * The draft is keyed by the signed-in user as well as the target, because the
 * storage belongs to the browser: a shared terminal would otherwise hand one
 * person's parked list to whoever signs in next. With no user resolved there
 * is no way to keep them apart, so nothing is stored at all.
 *
 * @param args - See {@link UseScanDraftArgs}
 * @returns `restoreDraft`, to call once per target right after the session
 *   hook's entry clear. It puts a parked list back on `scannedItemsAtom` and
 *   says whether there was one. `draftKey` is the storage key, or `null` when
 *   no user is resolved.
 */
export function useScanDraft({
  scope,
  targetId,
  seededTargetIdRef,
}: UseScanDraftArgs): {
  restoreDraft: () => boolean;
  draftKey: string | null;
} {
  const scannedItems = useAtomValue(scannedItemsAtom);
  const setScannedItems = useSetAtom(scannedItemsAtom);
  const store = useStore();

  const navigation = useNavigation();
  const location = useLocation();

  const userId = useUserData()?.id;
  const draftKey = useMemo(
    () => (userId ? scanDraftKey(scope, userId, targetId) : null),
    [scope, userId, targetId]
  );

  // Set once a submission is accepted. Rows restored from a draft resolve
  // asynchronously, so one can land after the submit has cleared the draft but
  // before the route unmounts; mirroring that would write the scans back and
  // offer work that has already been saved.
  const acceptedSubmitRef = useRef(false);

  const restoreDraft = useCallback(() => {
    // A newly seeded target is a new list to keep. The flag stays set for
    // late resolutions belonging to the target that was just submitted,
    // because this only runs when the target changes.
    acceptedSubmitRef.current = false;

    // Restored entries carry no `data`, so each row resolves against the
    // server again and a list parked overnight comes back current.
    const draft = draftKey ? readScanDraft(draftKey) : null;
    if (draft) {
      setScannedItems(draft);
    }
    return draft !== null;
  }, [draftKey, setScannedItems]);

  useEffect(() => {
    if (seededTargetIdRef.current !== targetId) {
      return;
    }
    if (!draftKey || acceptedSubmitRef.current) {
      return;
    }
    // Read the list from the store rather than from this render. The session
    // hook's seeding effect writes the atom, so the render that schedules this
    // effect can still close over the pre-seed list: the empty object the
    // entry clear produces, or whatever the last flow left behind. Saving that
    // would wipe the draft the seed restores from, and React's development
    // double-mount makes the loss permanent. The store holds the current list.
    saveScanDraft(draftKey, store.get(scannedItemsAtom));
  }, [scannedItems, draftKey, targetId, seededTargetIdRef, store]);

  // A submission that navigates away is one the action accepted: these scans
  // are saved, so the draft must not offer them again.
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

  return { restoreDraft, draftKey };
}

/**
 * Keeps a draft for a scanner that has no session hook of its own.
 *
 * The kit, location and bulk-action scanners start from the empty list the
 * layout's route-change reset leaves them, and seed nothing else. This hook is
 * their whole session setup: once per target it puts a parked list back, and
 * from then on {@link useScanDraft} mirrors the list and removes the draft on
 * an accepted save or an emptied list.
 *
 * A scanner that shows its list only in one of several modes passes the
 * current mode as `context`. It is remembered with the draft and handed back
 * through `onRestore` when a parked list is put back, so the scanner can
 * return to the mode the list was parked in. A list restored into a mode that
 * does not show it would look lost.
 *
 * @param args.scope - The flow, distinct per scanner
 * @param args.targetId - What is being scanned into
 * @param args.context - What the operator is doing with the list right now,
 *   or `null` when the current mode has no list to speak of
 * @param args.onRestore - Called once, when a parked list is put back, with
 *   the context it was parked in
 */
export function useScanDraftOnEntry({
  scope,
  targetId,
  context = null,
  onRestore,
}: {
  scope: string;
  targetId: string;
  context?: string | null;
  onRestore?: (context: string | null) => void;
}): void {
  // The target the parked list was last put back for. Nothing is mirrored
  // before that, so the list as it was on arrival cannot overwrite the draft.
  const restoredTargetIdRef = useRef<string | null>(null);

  const { restoreDraft, draftKey } = useScanDraft({
    scope,
    targetId,
    seededTargetIdRef: restoredTargetIdRef,
  });

  // Read through a ref so a caller's inline callback does not re-run the
  // once-per-target effect below.
  const onRestoreRef = useRef(onRestore);
  useEffect(() => {
    onRestoreRef.current = onRestore;
  }, [onRestore]);

  useEffect(() => {
    if (restoredTargetIdRef.current === targetId) {
      return;
    }
    restoredTargetIdRef.current = targetId;
    if (restoreDraft() && draftKey) {
      onRestoreRef.current?.(readScanDraftContext(draftKey));
    }
  }, [targetId, restoreDraft, draftKey]);

  // Remember the mode the operator last chose. A `null` context (a mode with
  // no list) leaves the last one in place: that is the one to go back to.
  useEffect(() => {
    if (restoredTargetIdRef.current !== targetId || !draftKey || !context) {
      return;
    }
    saveScanDraftContext(draftKey, context);
  }, [context, draftKey, targetId]);
}
