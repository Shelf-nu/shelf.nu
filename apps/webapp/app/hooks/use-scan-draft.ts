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
 * **The rule:** a parked list is cleared only on a confirmed answer (the save
 * succeeded, or the operator emptied the list). Anything else keeps it,
 * marked unconfirmed from the moment the save starts: a save still waiting,
 * one that got no answer, and one dismissed before it answered all leave the
 * list in the draft with the "may have gone through" warning. A save the
 * server refused takes the mark back off, unless an earlier attempt at the
 * same list had left it.
 *
 * @see {@link file://./../utils/scan-draft.ts} for what a draft holds.
 * @see {@link file://./use-booking-fulfil-session-initialization.ts}
 * @see {@link file://./use-booking-assign-session-initialization.ts}
 * @see {@link file://./use-booking-checkin-session-initialization.ts}
 */
import type { RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { atom, useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import { useActionData, useLocation, useNavigation } from "react-router";
import {
  scannedAssetQuantitiesAtom,
  scannedAssetSourcesAtom,
  scannedItemsAtom,
} from "~/atoms/qr-scanner";
import { useUserData } from "~/hooks/use-user-data";
import {
  clearScanDraft,
  readScanDraft,
  readScanDraftChoices,
  readScanDraftContext,
  readScanDraftUnconfirmedSave,
  saveScanDraft,
  scanDraftKey,
} from "~/utils/scan-draft";
import type { ScanSubmitFailure } from "~/utils/scan-submit-failure";
import { getScanSubmitFailure } from "~/utils/scan-submit-failure";

/**
 * Where the auth middleware sends a request whose session has ended. A save
 * that lands here was never run: the middleware turned it away before the
 * route's action, so its draft is the only copy of the list left.
 */
const SIGN_IN_PATH = "/login";

/**
 * Whether the list on screen was sent in a save that got no answer, so it may
 * already be saved. Raised when the route's action reports such a failure, or
 * when a restored draft carries the mark; lowered when the list is emptied, a
 * draft without the mark is restored, or the scanner unmounts. It is stored
 * with the draft, so the warning survives a reload together with the list,
 * and `ScanSubmitFailureAlert` shows it when the failure itself is gone.
 */
export const unconfirmedScanSaveAtom = atom(false);

/**
 * The save failure whose list has since been emptied. React Router keeps the
 * last action answer until the next submission, so without this a new list
 * scanned on the same page would show the old failure's notice although it
 * was never sent. `ScanSubmitFailureAlert` ignores the failure held here.
 */
export const retiredScanSubmitFailureAtom = atom<ScanSubmitFailure | null>(
  null
);

/**
 * Raised by a scanner that saves in place, without navigating, once its save
 * has succeeded. {@link useScanDraft} answers by removing the draft, and the
 * flag goes back down as soon as it has been read.
 */
const scanListSavedInPlaceAtom = atom(false);

/**
 * Whether any part of a save sent in parts (assets and kits go to separate
 * endpoints) has been saved. Once one has, the list must not come back from
 * its draft: sending it again would repeat that part, and a custody change
 * adds units rather than setting them. Closing the result dialog empties the
 * list in that case too, so the draft goes the same way, only sooner.
 *
 * @param statuses - Each part's status, e.g. `["success", "error"]`
 * @returns `true` once at least one part is saved
 */
export function anyPartSaved(statuses: readonly string[]): boolean {
  return statuses.some((status) => status === "success");
}

/** How a save that stays on the page ended, for {@link useInPlaceSaveMark}. */
export type InPlaceSaveAnswer =
  /** At least part of it was saved; the draft goes through the save signal. */
  | "saved"
  /** The server answered and saved nothing. */
  | "refused"
  /** No answer: the request failed, or the answer was a gateway's page. */
  | "unanswered";

/**
 * How a save sent in parts ended, once every part has answered.
 *
 * @param statuses - Each part's status: `"processing"`, `"success"`,
 *   `"error"` or `"skipped"`
 * @param noAnswer - Whether any part got no answer
 * @returns The answer, or `null` while a part is still waiting
 */
export function inPlaceSaveAnswer(
  statuses: readonly string[],
  noAnswer: boolean
): InPlaceSaveAnswer | null {
  if (statuses.includes("processing")) {
    return null;
  }
  if (noAnswer) {
    return "unanswered";
  }
  return anyPartSaved(statuses) ? "saved" : "refused";
}

/**
 * The unconfirmed mark for a scanner that saves in place (the bulk actions),
 * which has no route action for {@link useScanDraft} to watch.
 *
 * `start` puts the mark on as the save is sent, so a reload while it waits
 * keeps the warning with the list. `settle` reads the answer: a refusal takes
 * back only what this attempt added, no answer keeps the mark, and a save
 * leaves the draft to the save signal ({@link useClearScanDraftOnSave}).
 *
 * @returns `start` and `settle`, stable across renders
 */
export function useInPlaceSaveMark(): {
  start: () => void;
  settle: (answer: InPlaceSaveAnswer) => void;
} {
  const store = useStore();
  const setUnconfirmedSave = useSetAtom(unconfirmedScanSaveAtom);
  const earlierMarkRef = useRef(false);

  const start = useCallback(() => {
    earlierMarkRef.current = store.get(unconfirmedScanSaveAtom);
    setUnconfirmedSave(true);
  }, [store, setUnconfirmedSave]);

  const settle = useCallback(
    (answer: InPlaceSaveAnswer) => {
      if (answer === "refused") {
        setUnconfirmedSave(earlierMarkRef.current);
      }
    },
    [setUnconfirmedSave]
  );

  return useMemo(() => ({ start, settle }), [start, settle]);
}

/**
 * Tells the scan draft that the list on screen has been saved, for a scanner
 * whose save stays on the page (the bulk actions show the result in a dialog
 * and empty the list only when it is closed). Without this, a reload while
 * the result is still on screen would bring back a list that already saved.
 *
 * @param saved - `true` once the save has fully succeeded. Nothing happens
 *   while it is `false`, so a refused or partly failed save keeps its draft.
 */
export function useClearScanDraftOnSave(saved: boolean): void {
  const setSavedInPlace = useSetAtom(scanListSavedInPlaceAtom);
  useEffect(() => {
    if (saved) {
      setSavedInPlace(true);
    }
  }, [saved, setSavedInPlace]);
}

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
  /**
   * Stored with the draft on every save and handed back by
   * `readScanDraftContext`. See {@link useScanDraftOnEntry}.
   */
  context?: string | null;
};

/**
 * Keeps a draft of the scan list for one flow on one target.
 *
 * - Mirrors `scannedItemsAtom` into the draft as it changes, once the caller
 *   has seeded its session. An emptied list removes the draft.
 * - Removes the draft when a submission is accepted, which is the one that
 *   navigates away to a page of the app. A submission that stays on the page
 *   (refused, or never answered), or that the auth middleware sends to the
 *   sign-in page (it never ran), keeps its draft.
 * - Removes the draft when a scanner that saves in place says its save
 *   succeeded ({@link useClearScanDraftOnSave}), and stores nothing more until
 *   that list has been emptied.
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
  context = null,
}: UseScanDraftArgs): {
  restoreDraft: () => boolean;
  draftKey: string | null;
} {
  const scannedItems = useAtomValue(scannedItemsAtom);
  const setScannedItems = useSetAtom(scannedItemsAtom);
  // The units and source locations set on the rows. Kept with the codes, so
  // a restored row is put back as the operator left it.
  const scannedQuantities = useAtomValue(scannedAssetQuantitiesAtom);
  const setScannedQuantities = useSetAtom(scannedAssetQuantitiesAtom);
  const scannedSources = useAtomValue(scannedAssetSourcesAtom);
  const setScannedSources = useSetAtom(scannedAssetSourcesAtom);
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

  // Set once a scanner that saves in place reports success. Its list stays on
  // screen under the result until the operator dismisses it, and mirroring
  // that list would put the saved scans straight back. Lowered when the list
  // is emptied, so the next list on the same page is kept again.
  const savedInPlaceRef = useRef(false);
  const [savedInPlace, setSavedInPlace] = useAtom(scanListSavedInPlaceAtom);

  const [unconfirmedSave, setUnconfirmedSave] = useAtom(
    unconfirmedScanSaveAtom
  );
  // The mark goes on when the save starts, so a reload while it is still
  // waiting keeps the warning with the list. `earlierMarkRef` holds the mark
  // as it was before this attempt, so a refusal can take back only what this
  // attempt added. `awaitingAnswerRef` is set from the start of a save until
  // its answer is read.
  const earlierMarkRef = useRef(false);
  const awaitingAnswerRef = useRef(false);
  const savingHere =
    navigation.state === "submitting" &&
    navigation.formMethod?.toUpperCase() === "POST";
  useEffect(() => {
    if (!savingHere || awaitingAnswerRef.current) {
      return;
    }
    awaitingAnswerRef.current = true;
    earlierMarkRef.current = store.get(unconfirmedScanSaveAtom);
    setUnconfirmedSave(true);
  }, [savingHere, store, setUnconfirmedSave]);

  // Read each answer once. Keyed on the answer itself, not on a yes/no: each
  // save answers with a new object, so a second unanswered save after the
  // list was emptied and refilled marks the new list too.
  const actionData = useActionData();
  const submitFailure = getScanSubmitFailure(actionData);
  const submitFailureRef = useRef(submitFailure);
  submitFailureRef.current = submitFailure;
  useEffect(() => {
    if (actionData === undefined) {
      return;
    }
    const awaited = awaitingAnswerRef.current;
    awaitingAnswerRef.current = false;
    if (submitFailure && submitFailure.kind !== "rejected") {
      // No answer: the save may have gone through.
      setUnconfirmedSave(true);
    } else if (awaited) {
      // A definite answer that stayed on the page: the server refused the
      // save, or a gateway turned it away before the server saw it. Nothing
      // was saved by this attempt.
      setUnconfirmedSave(earlierMarkRef.current);
    }
  }, [actionData, submitFailure, setUnconfirmedSave]);

  // The mark belongs to this scanner's list: the next scanner starts clean.
  useEffect(() => () => setUnconfirmedSave(false), [setUnconfirmedSave]);

  const restoreDraft = useCallback(() => {
    // A newly seeded target is a new list to keep. The flag stays set for
    // late resolutions belonging to the target that was just submitted,
    // because this only runs when the target changes.
    acceptedSubmitRef.current = false;

    // Restored entries carry no `data`, so each row resolves against the
    // server again and a list parked overnight comes back current.
    const draft = draftKey ? readScanDraft(draftKey) : null;
    if (draft && draftKey) {
      const { quantities, sources } = readScanDraftChoices(draftKey);
      setScannedQuantities(quantities);
      setScannedSources(sources);
      setScannedItems(draft);
    }
    setUnconfirmedSave(
      draft !== null &&
        draftKey !== null &&
        readScanDraftUnconfirmedSave(draftKey)
    );
    return draft !== null;
  }, [
    draftKey,
    setScannedItems,
    setScannedQuantities,
    setScannedSources,
    setUnconfirmedSave,
  ]);

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
    const current = store.get(scannedItemsAtom);
    const emptied = Object.keys(current).length === 0;
    if (savedInPlaceRef.current) {
      if (!emptied) {
        return;
      }
      savedInPlaceRef.current = false;
    }
    // An emptied list has nothing left that may have been saved, and the
    // notice about its save goes with it.
    if (emptied && store.get(unconfirmedScanSaveAtom)) {
      setUnconfirmedSave(false);
    }
    if (emptied && submitFailureRef.current) {
      store.set(retiredScanSubmitFailureAtom, submitFailureRef.current);
    }
    saveScanDraft(draftKey, current, {
      context,
      choices: {
        quantities: store.get(scannedAssetQuantitiesAtom),
        sources: store.get(scannedAssetSourcesAtom),
      },
      unconfirmedSave: !emptied && store.get(unconfirmedScanSaveAtom),
    });
  }, [
    scannedItems,
    scannedQuantities,
    scannedSources,
    unconfirmedSave,
    draftKey,
    targetId,
    seededTargetIdRef,
    store,
    context,
    setUnconfirmedSave,
  ]);

  // A scanner that saves in place said its save went through.
  useEffect(() => {
    if (!savedInPlace) {
      return;
    }
    setSavedInPlace(false);
    if (!draftKey) {
      return;
    }
    savedInPlaceRef.current = true;
    clearScanDraft(draftKey);
  }, [savedInPlace, setSavedInPlace, draftKey]);

  // A submission that navigates away is one the action accepted: these scans
  // are saved, so the draft must not offer them again. Every scanner action
  // redirects only on success, and answers a refusal on the page. The one
  // other redirect is the auth middleware's, to the sign-in page, when the
  // session ended: the action never ran, and after signing back in the
  // operator lands on the scanner again, where the draft puts the list back.
  useEffect(() => {
    const submittedAway =
      navigation.state === "loading" &&
      navigation.formMethod?.toUpperCase() === "POST" &&
      navigation.location !== undefined &&
      navigation.location.pathname !== location.pathname &&
      navigation.location.pathname !== SIGN_IN_PATH;

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

  // The mode last worked in that shows a list. A `null` context (a mode with
  // no list) leaves it in place: that is the one to go back to. Stored with
  // every save of the draft, so it lives and expires with the list.
  const [listContext, setListContext] = useState<string | null>(context);
  useEffect(() => {
    if (context) {
      setListContext(context);
    }
  }, [context]);

  const { restoreDraft, draftKey } = useScanDraft({
    scope,
    targetId,
    seededTargetIdRef: restoredTargetIdRef,
    context: listContext,
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
      const parkedContext = readScanDraftContext(draftKey);
      // Kept until the caller switches to a mode of its own, so the next save
      // does not drop it.
      if (parkedContext) {
        setListContext(parkedContext);
      }
      onRestoreRef.current?.(parkedContext);
    }
  }, [targetId, restoreDraft, draftKey]);
}
