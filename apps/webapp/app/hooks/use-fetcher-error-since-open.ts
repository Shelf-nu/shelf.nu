/**
 * Server Error For The Current Opening Of A Dialog
 *
 * A dialog that submits through a keyed `useFetcher` keeps that fetcher's last
 * response after it closes. Read straight from `fetcher.data`, a refusal from
 * a previous attempt is shown again the next time the dialog opens, and every
 * dialog sharing the key shows it too. This hook returns the error message
 * only when the response arrived while the dialog was open this time.
 *
 * @see {@link file://../components/assets/quantity-custody-dialog.tsx}
 * @see {@link file://../components/assets/release-by-source-button.tsx}
 */

import { useState } from "react";

/** The part of a fetcher this hook reads. */
type FetcherWithData = { data?: unknown };

/** Reads `{ error: { message } }` from a fetcher response, if it has one. */
function errorMessageOf(data: unknown): string | null {
  if (!data || typeof data !== "object" || !("error" in data)) return null;
  const { error } = data as { error?: { message?: unknown } | null };
  return typeof error?.message === "string" ? error.message : null;
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
  const [wasOpen, setWasOpen] = useState(open);
  const [dataAtOpen, setDataAtOpen] = useState<unknown>(
    open ? undefined : fetcher.data
  );

  // Adjusting state while rendering, React's documented pattern for state
  // derived from a prop change: the stale response is recorded in the same
  // render that opens the dialog, so it never flashes.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setDataAtOpen(fetcher.data);
  }

  if (!open || fetcher.data === dataAtOpen) return null;
  return errorMessageOf(fetcher.data);
}
