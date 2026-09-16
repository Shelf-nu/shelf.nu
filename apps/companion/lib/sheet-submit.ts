/**
 * Submitting a change from a sheet that stays open until the server accepts it.
 *
 * Closing a sheet before its request settles throws away what the user entered
 * whenever the server refuses the change: an editing sheet such as the
 * placements editor re-seeds from the unchanged record when it reopens, and a
 * multi-step queue such as a booking check-in starts over. So the request runs
 * with the sheet still on screen, the sheet shows it in progress, and it closes
 * only once the change is accepted.
 *
 * Pure, and free of React Native, Expo and `@/`-aliased imports, so the
 * `lib/**` node test runner can exercise the whole sequence. The caller
 * supplies the platform pieces: the error alert, closing the sheet, the
 * refetch.
 *
 * @see {@link file://./../hooks/use-sheet-submit.ts} the React binding
 * @see {@link file://./../app/(tabs)/assets/[id].tsx} the asset screen's sheets
 * @see {@link file://./../app/(tabs)/bookings/[id].tsx} the booking check-in and check-out queues
 */

/** Shown when a request throws instead of resolving with an error. */
export const SHEET_SUBMIT_FALLBACK_ERROR = "Something went wrong";

/**
 * The in-flight flag shared by every submit it guards; `useRef(false)` is one.
 * A ref rather than state, because a state flag cannot block a second tap
 * delivered in the same tick.
 */
export type SubmitLock = { current: boolean };

/** What a submit's request resolves to: every `api.*` call's shape. */
export type SheetSubmitResponse = { error: string | null };

/** One submit: the request, and what happens around it. */
export type SheetSubmit<
  TResponse extends SheetSubmitResponse = SheetSubmitResponse,
> = {
  /**
   * Held for the whole submit, refetch included. A submit that finds it held
   * does nothing.
   */
  lock: SubmitLock;
  /** The mutation. A throw counts as a failure. */
  request: () => Promise<TResponse>;
  /**
   * Runs once the server has accepted the change, with its response, and
   * before `refresh`. The sheet closes here: closing after the refetch would
   * let it re-seed from the refreshed record while still on screen.
   */
  onAccepted: (response: TResponse) => void;
  /**
   * Reloads the record the sheet edits. Omit it when the caller reloads later,
   * for example once the user dismisses its own success alert.
   */
  refresh?: () => Promise<void>;
  /**
   * Mirrors the in-flight state into the UI, which the sheet reads as
   * `isSubmitting`. True for the whole submit, refetch included.
   */
  setSubmitting: (submitting: boolean) => void;
  /**
   * Explains a refused or failed change. The sheet is still open, with the
   * user's input, when this runs.
   */
  showError: (message: string) => void;
};

/**
 * Sends a sheet's change, and closes the sheet only if the server accepts it.
 *
 * @param submit - The request and the callbacks around it; see
 *   {@link SheetSubmit}.
 * @returns True when the server accepted the change. False when it refused,
 *   the request failed, or another submit still held the lock.
 */
export async function submitFromSheet<TResponse extends SheetSubmitResponse>({
  lock,
  request,
  onAccepted,
  refresh,
  setSubmitting,
  showError,
}: SheetSubmit<TResponse>): Promise<boolean> {
  if (lock.current) return false;
  lock.current = true;
  setSubmitting(true);

  try {
    const outcome = await settle(request);
    if (!outcome.accepted) {
      showError(outcome.error);
      return false;
    }
    onAccepted(outcome.response);
    await refresh?.();
    return true;
  } finally {
    // Released on every path. A lock left held would strand the user in a
    // sheet whose controls stay disabled and which refuses to close.
    lock.current = false;
    setSubmitting(false);
  }
}

/** A request's outcome: the accepted response, or the message explaining why not. */
type Settled<TResponse> =
  | { accepted: true; response: TResponse }
  | { accepted: false; error: string };

/**
 * Runs the request and sorts its outcome into accepted or refused.
 *
 * @param request - The mutation to run.
 * @returns The response when the server accepted the change; otherwise its
 *   error, or the fallback message when the request throws.
 */
async function settle<TResponse extends SheetSubmitResponse>(
  request: () => Promise<TResponse>
): Promise<Settled<TResponse>> {
  try {
    const response = await request();
    return response.error
      ? { accepted: false, error: response.error }
      : { accepted: true, response };
  } catch {
    return { accepted: false, error: SHEET_SUBMIT_FALLBACK_ERROR };
  }
}
