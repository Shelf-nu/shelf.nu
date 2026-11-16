/**
 * The result of a bulk "Update location" save from the scanner.
 *
 * Assets and kits are saved by separate requests, and the result decides
 * whether the list and its scan draft are kept, so it is built here from each
 * part's answer.
 *
 * @see {@link file://./update-location-drawer.tsx}
 */

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
