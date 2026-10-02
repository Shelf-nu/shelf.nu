/**
 * Lets only the newest request answer.
 *
 * A screen that fetches on every keystroke, filter tap or page has several
 * requests in the air at once, and they do not come back in the order they
 * were sent. Whichever lands last wins the list, so a slow answer to "lap"
 * can overwrite the rows for "laptop" and leave the screen showing results
 * for a query the operator has already moved past.
 *
 * `apiFetch` answers an aborted request with neither data nor an error, which
 * is the shape its callers already skip, so aborting the previous request is
 * all it takes to make the race unwinnable. It also stops the work: the socket
 * closes instead of finishing a response nobody will read.
 *
 * One of these per screen, held in a ref so it survives re-renders.
 *
 * @see {@link file://./api/client.ts} `apiFetch`, which turns an abort into
 *   `{ data: null, error: null }`
 */

/** Hands out the signal for the newest request on one screen. */
export type LatestRequest = {
  /**
   * Abandons whatever is in flight and claims the slot for a new request.
   *
   * @returns The signal to pass to the new request
   */
  begin: () => AbortSignal;
  /**
   * Abandons whatever is in flight without starting anything.
   *
   * For the moment a screen's subject changes, such as a switch to another
   * workspace: an answer about the old one must not arrive afterwards and
   * repopulate the list.
   */
  cancel: () => void;
};

/**
 * Mirrors an abandoned request onto the controller that carries it out.
 *
 * `addEventListener` is never called back for an abort that already happened,
 * so a signal has to be tested as well as listened to. Anything that waits
 * before chaining, such as resolving an access token, can otherwise let an
 * abort fall through the gap: the listener attaches to a signal that has
 * already fired, nothing cancels the request, and it answers with data the
 * caller has moved past. Chain before the first await, not after it.
 *
 * @param controller - The controller to abort
 * @param signal - The caller's signal, if it gave one
 */
export function chainAbort(
  controller: AbortController,
  signal?: AbortSignal | null
): void {
  if (!signal) {
    return;
  }
  if (signal.aborted) {
    controller.abort();
    return;
  }
  signal.addEventListener("abort", () => controller.abort());
}

/**
 * Creates a {@link LatestRequest} for one screen.
 *
 * @returns A fresh tracker with nothing in flight
 */
export function createLatestRequest(): LatestRequest {
  let inFlight: AbortController | null = null;

  return {
    begin() {
      inFlight?.abort();
      inFlight = new AbortController();
      return inFlight.signal;
    },
    cancel() {
      inFlight?.abort();
      inFlight = null;
    },
  };
}
