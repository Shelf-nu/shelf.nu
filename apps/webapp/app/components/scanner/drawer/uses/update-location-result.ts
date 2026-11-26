/**
 * The result of a bulk "Update location" save from the scanner.
 *
 * Assets and kits are saved by separate requests, and the result decides
 * whether the list and its scan draft are kept, so it is built here from each
 * part's answer.
 *
 * @see {@link file://./update-location-drawer.tsx}
 */
import type { BulkPartStatuses } from "~/hooks/use-bulk-save-settle";

/** Where the save stands, as the result dialog shows it. */
export type LocationState = {
  status: "processing" | "success" | "error";
  errorMessage?: string;
};

/**
 * Folds one part's answer (assets and kits are saved by separate requests)
 * into the save's result. A failure in any part fails the save, and a later
 * part that succeeds does not overwrite it: the result decides whether the
 * list and its scan draft are kept.
 *
 * @param current - The result so far
 * @param answer - One endpoint's JSON answer
 * @returns The result including this part
 */
export function foldLocationPart(
  current: LocationState,
  answer: { error?: { message: string } }
): LocationState {
  if (answer.error) {
    return { status: "error", errorMessage: answer.error.message };
  }
  return current.status === "error" ? current : { status: "success" };
}

/** One endpoint's JSON answer: the app's refusal, or a save. */
type LocationPartAnswer = { error?: { message: string } };

/** Where a location save stands: its result, and each part's status. */
export type LocationSaveProgress = {
  result: LocationState;
  parts: BulkPartStatuses;
};

/**
 * Sends a location save's parts in order, assets first, then kits.
 *
 * The kits are sent only while the save is still the current one. Once the
 * operator closes the dialog the list stays, and can be saved again to
 * another location, so a kit request sent after that could move the kits
 * back over the newer save.
 *
 * @param args.sendAssets - Sends the assets part, or `null` when it has none
 * @param args.sendKits - Sends the kits part, or `null` when it has none
 * @param args.isCurrent - Whether this save is still the one the dialog shows
 * @param args.onProgress - Called with the state before anything is sent and
 *   after the assets answer, so a part that saved is known if the next throws
 * @returns The final state, or `null` when the save stopped being current
 *   before its kits were sent
 * @throws Whatever a send throws: the request got no answer
 */
export async function sendLocationParts({
  sendAssets,
  sendKits,
  isCurrent,
  onProgress,
}: {
  sendAssets: (() => Promise<LocationPartAnswer>) | null;
  sendKits: (() => Promise<LocationPartAnswer>) | null;
  isCurrent: () => boolean;
  onProgress: (progress: LocationSaveProgress) => void;
}): Promise<LocationSaveProgress | null> {
  let result: LocationState = { status: "processing" };
  let parts: BulkPartStatuses = {
    assets: sendAssets ? "processing" : "skipped",
    kits: sendKits ? "processing" : "skipped",
  };
  onProgress({ result, parts });

  if (sendAssets) {
    const answer = await sendAssets();
    result = foldLocationPart(result, answer);
    parts = { ...parts, assets: answer.error ? "error" : "success" };
    if (sendKits) {
      onProgress({ result: { status: "processing" }, parts });
    }
  }

  if (sendKits) {
    if (!isCurrent()) {
      return null;
    }
    const answer = await sendKits();
    result = foldLocationPart(result, answer);
    parts = { ...parts, kits: answer.error ? "error" : "success" };
  }

  return { result, parts };
}
