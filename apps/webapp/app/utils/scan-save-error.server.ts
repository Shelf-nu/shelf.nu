/**
 * The answer a scanner route's action gives when its save fails.
 *
 * A refusal (4xx) means the server turned the save away and nothing was
 * stored, so the scanner may take its "may have gone through" mark off. A 5xx
 * the app answers itself does not mean that: a save can commit its changes and
 * then fail in a later step (a status event, a scheduler, a note), and the
 * browser cannot read the HTTP status of an action answer, only its body. So
 * a 5xx answer also carries a `server` scan submit failure in its body, which
 * the scanner reads the same way as a save that got no answer at all: the list
 * stays marked, and the operator is told to check before confirming again.
 *
 * Use it in the `catch` of every scanner route action that exports
 * `keepScanListOnSubmitFailure` as its client action.
 *
 * @see {@link file://./scan-submit-failure.ts}
 * @see {@link file://./../hooks/use-scan-draft.ts}
 */
import { data } from "react-router";
import type { ShelfError } from "./error";
import { error } from "./http.server";
import type { ScanSubmitFailureData } from "./scan-submit-failure";

/**
 * Builds a scanner save's failure answer.
 *
 * @param reason - The error the save failed with
 * @returns The app's error payload with the error's status. A 5xx payload
 *   also carries `scanSubmitFailure` of kind `server`.
 */
export function scanSaveError(reason: ShelfError) {
  const status = reason.status;
  const body = error(reason);
  if (status < 500) {
    return data(body, { status });
  }
  const serverFailure: ScanSubmitFailureData = {
    scanSubmitFailure: { kind: "server", status },
  };
  return data({ ...body, ...serverFailure }, { status });
}
