/**
 * What The Server Said During This Opening Of A Dialog
 *
 * A dialog that submits through a keyed `useFetcher` keeps that fetcher's last
 * response after it closes, and every dialog sharing the key reads the same
 * one. Read straight from `fetcher.data`, that response is answered to the
 * wrong opening, in both directions:
 *
 * - a refusal is shown again the next time the dialog opens, when nothing is
 *   wrong this time;
 * - a success is acted on again, so a dialog that closes itself on success
 *   shuts the instant it reopens, which leaves the control dead.
 *
 * These hooks report the response only when it arrived during the opening in
 * front of the operator. Both ways a dialog reaches an opening are covered:
 * one that stays mounted and toggles an `open` prop, and one that is rendered
 * only while open and so is mounted fresh each time.
 *
 * @see {@link file://../components/assets/quantity-custody-dialog.tsx}
 * @see {@link file://../components/assets/release-by-source-button.tsx}
 * @see {@link file://../components/assets/quick-adjust-dialog.tsx}
 * @see {@link file://../components/booking/adjust-booking-asset-quantity-dialog.tsx}
 */

import { useState } from "react";

/** The part of a fetcher these hooks read. */
type FetcherWithData = { data?: unknown };

/**
 * The server's answer to the current opening of a dialog.
 *
 * `pending` covers both "nothing submitted yet" and "a response that belongs
 * to an earlier opening", because a dialog must treat those the same way.
 *
 * Every field is a primitive, so depend on `status` and `message` directly
 * rather than on the returned object, which is rebuilt each render.
 */
export type FetcherOutcomeSinceOpen =
  | { status: "pending"; message: null }
  | { status: "rejected"; message: string | null }
  | { status: "accepted"; message: null };

const PENDING: FetcherOutcomeSinceOpen = { status: "pending", message: null };
const ACCEPTED: FetcherOutcomeSinceOpen = { status: "accepted", message: null };

/**
 * Whether a response is a refusal.
 *
 * Only a non-null `error` VALUE says so. The `payload()` helper stamps
 * `error: null` onto every success, so the key is always present and its
 * presence says nothing.
 *
 * @param data - A fetcher response of unknown shape.
 * @returns True when the action refused.
 */
function isRejection(data: unknown): boolean {
  if (!data || typeof data !== "object" || !("error" in data)) return false;
  return (data as { error?: unknown }).error != null;
}

/** Reads `{ error: { message } }` from a fetcher response, if it has one. */
function errorMessageOf(data: unknown): string | null {
  if (!data || typeof data !== "object" || !("error" in data)) return null;
  const { error } = data as { error?: { message?: unknown } | null };
  return typeof error?.message === "string" ? error.message : null;
}

/**
 * The server's answer to this opening of the dialog, ignoring any response
 * that was already in the fetcher when the dialog opened.
 *
 * @param fetcher - The dialog's fetcher.
 * @param open - Whether the dialog is open.
 * @returns The outcome for this opening.
 */
export function useFetcherOutcomeSinceOpen(
  fetcher: FetcherWithData,
  open: boolean
): FetcherOutcomeSinceOpen {
  const [wasOpen, setWasOpen] = useState(open);
  // Snapshot whatever the fetcher is already holding, whether or not the
  // dialog starts open. A dialog rendered only while open is mounted fresh on
  // each opening, so its first render IS an opening, and a response that
  // predates this instance was never an answer to it.
  const [dataAtOpen, setDataAtOpen] = useState<unknown>(fetcher.data);

  // Adjusting state while rendering, React's documented pattern for state
  // derived from a prop change: the stale response is recorded in the same
  // render that opens the dialog, so it never flashes.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setDataAtOpen(fetcher.data);
  }

  // A fetcher clears its data when the next submission starts, so an absent
  // response is pending and never an acceptance.
  if (!open || fetcher.data === undefined || fetcher.data === dataAtOpen) {
    return PENDING;
  }

  return isRejection(fetcher.data)
    ? { status: "rejected", message: errorMessageOf(fetcher.data) }
    : ACCEPTED;
}

/**
 * The fetcher's error message, ignoring any response that was already there
 * when the dialog last opened.
 *
 * @param fetcher - The dialog's fetcher
 * @param open - Whether the dialog is open
 * @returns The message to show, or null
 */
export function useFetcherErrorSinceOpen(
  fetcher: FetcherWithData,
  open: boolean
): string | null {
  return useFetcherOutcomeSinceOpen(fetcher, open).message;
}
