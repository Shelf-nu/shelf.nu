/**
 * Settles a bulk scanner save that is sent in parts and stays on the page.
 *
 * The bulk actions on `/scanner` (assign custody, release custody, update
 * location) save assets and kits through separate requests and show the
 * result in a dialog over the list. Each part can save, be refused, or get no
 * answer, and the list must then hold exactly what still needs a confirmed
 * answer:
 *
 * - every part saved: the draft goes now, the list when the dialog is closed;
 * - a part saved and another did not: the saved part's rows leave the list at
 *   once (a retry must not send them again, a custody change adds units), and
 *   the rest stays with its draft;
 * - nothing saved: the list stays. A refusal takes the "may have gone through"
 *   mark back off, no answer keeps it.
 *
 * The decisions are the pure functions {@link settleBulkSave} and
 * {@link dismissBulkSave}; {@link useBulkSaveSettle} applies them.
 *
 * @see {@link file://./use-scan-draft.ts} for the draft and its mark
 * @see {@link file://./../components/scanner/drawer/uses/assign-custody-drawer.tsx}
 */
import { useCallback, useEffect, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import type { ScanListItems } from "~/atoms/qr-scanner";
import {
  clearScannedItemsAtom,
  removeMultipleScannedItemsAtom,
  scannedItemsAtom,
} from "~/atoms/qr-scanner";
import type { InPlaceSaveAnswer, SubmittedParts } from "./use-scan-draft";
import {
  allPartsSaved,
  inPlaceSaveAnswer,
  savedPartRows,
  useClearScanDraftOnSave,
  useInPlaceSaveMark,
} from "./use-scan-draft";

/** Where one part of a bulk save stands. */
export type BulkPartStatus = "processing" | "success" | "error" | "skipped";

/** The status of each part: assets and kits are saved separately. */
export type BulkPartStatuses = {
  assets: BulkPartStatus;
  kits: BulkPartStatus;
};

/** What a bulk save sent, and where each part stands now. */
type BulkSaveState = {
  statuses: BulkPartStatuses;
  /** The scan list on screen. */
  items: ScanListItems;
  /** The asset and kit ids each part sent. */
  submitted: SubmittedParts;
};

/** The rows of the parts that saved. */
function rowsOfSavedParts({ statuses, items, submitted }: BulkSaveState) {
  return savedPartRows(items, submitted, {
    assets: statuses.assets === "success",
    kits: statuses.kits === "success",
  });
}

/**
 * How a bulk save ended, once every part has answered.
 *
 * @param state - See {@link BulkSaveState}
 * @param state.noAnswer - Whether any part got no answer
 * @returns `null` while a part is still waiting. Otherwise the answer for the
 *   draft's mark, and the rows to take out of the list now: none when the
 *   whole list saved (it empties when the dialog is closed), the saved part's
 *   rows when only part of it did.
 */
export function settleBulkSave(
  state: BulkSaveState & { noAnswer: boolean }
): { answer: InPlaceSaveAnswer; rowsToRemove: string[] } | null {
  const answer = inPlaceSaveAnswer(
    [state.statuses.assets, state.statuses.kits],
    state.noAnswer
  );
  if (!answer) {
    return null;
  }
  return {
    answer,
    rowsToRemove: answer === "saved" ? [] : rowsOfSavedParts(state),
  };
}

/**
 * What closing the result dialog does to the list.
 *
 * The list is emptied only once the whole of it saved. A list that was
 * refused, got no answer, or is still waiting (Done pressed mid-save) stays
 * with its draft and its mark, less the rows of any part that already saved:
 * a late answer is ignored from here on, and a retry must not send them again.
 *
 * @param state - See {@link BulkSaveState}
 * @returns Whether to empty the list, or which rows to take out of it
 */
export function dismissBulkSave(state: BulkSaveState): {
  clearList: boolean;
  rowsToRemove: string[];
} {
  if (allPartsSaved([state.statuses.assets, state.statuses.kits])) {
    return { clearList: true, rowsToRemove: [] };
  }
  return { clearList: false, rowsToRemove: rowsOfSavedParts(state) };
}

/** One save started with {@link useBulkSaveSettle}'s `begin`. */
export type BulkSaveAttempt = {
  /**
   * Whether this is still the save the dialog shows. Closing the dialog or
   * starting another save moves it on, so a late answer must not set the
   * result (it could clear the next list's draft).
   */
  isCurrent: () => boolean;
  /** Records that a part got no answer: the server may have saved it. */
  markUnanswered: () => void;
};

/**
 * Applies {@link settleBulkSave} and {@link dismissBulkSave} for a bulk
 * drawer.
 *
 * @param args.statuses - Each part's status, as the result dialog shows it
 * @param args.dialogOpen - Whether the result dialog is open
 * @returns `begin`, to call as the save is sent (it marks the list
 *   unconfirmed), and `dismiss`, to call when the result dialog is closed
 */
export function useBulkSaveSettle({
  statuses,
  dialogOpen,
}: {
  statuses: BulkPartStatuses;
  dialogOpen: boolean;
}): {
  begin: (submitted: SubmittedParts) => BulkSaveAttempt;
  dismiss: () => void;
} {
  const items = useAtomValue(scannedItemsAtom);
  const removeRows = useSetAtom(removeMultipleScannedItemsAtom);
  const clearItems = useSetAtom(clearScannedItemsAtom);
  const saveMark = useInPlaceSaveMark();
  // The save the dialog shows, and the last one settled.
  const submissionRef = useRef(0);
  const settledRef = useRef(0);
  const noAnswerRef = useRef(false);
  const submittedRef = useRef<SubmittedParts>({ assetIds: [], kitIds: [] });
  const { assets, kits } = statuses;

  // The list stays on screen under the result until the dialog is closed.
  // Once the whole list has saved its draft goes, so a reload before then
  // does not bring back scans that are already saved.
  useClearScanDraftOnSave(allPartsSaved([assets, kits]));

  useEffect(() => {
    if (!dialogOpen || settledRef.current === submissionRef.current) {
      return;
    }
    const settled = settleBulkSave({
      statuses: { assets, kits },
      noAnswer: noAnswerRef.current,
      items,
      submitted: submittedRef.current,
    });
    if (!settled) {
      return;
    }
    settledRef.current = submissionRef.current;
    if (settled.rowsToRemove.length > 0) {
      removeRows(settled.rowsToRemove);
    }
    saveMark.settle(settled.answer);
  }, [assets, kits, dialogOpen, items, removeRows, saveMark]);

  const begin = useCallback(
    (submitted: SubmittedParts): BulkSaveAttempt => {
      const submission = ++submissionRef.current;
      noAnswerRef.current = false;
      submittedRef.current = submitted;
      saveMark.start();
      const isCurrent = () => submission === submissionRef.current;
      return {
        isCurrent,
        markUnanswered: () => {
          if (isCurrent()) {
            noAnswerRef.current = true;
          }
        },
      };
    },
    [saveMark]
  );

  const dismiss = useCallback(() => {
    submissionRef.current += 1;
    const { clearList, rowsToRemove } = dismissBulkSave({
      statuses: { assets, kits },
      items,
      submitted: submittedRef.current,
    });
    if (clearList) {
      clearItems();
    } else if (rowsToRemove.length > 0) {
      removeRows(rowsToRemove);
    }
  }, [assets, kits, items, clearItems, removeRows]);

  return { begin, dismiss };
}
