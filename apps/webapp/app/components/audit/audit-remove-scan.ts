/**
 * Reading the answer to an audit scan removal.
 *
 * The audit drawer drops a removed scan from its list at once and sends the
 * removal in the background. The server removes a scan in one transaction,
 * so an answer carrying an error means nothing was removed: the scan is still
 * on the audit while the list no longer shows it. The drawer does not try to
 * rebuild the row (the audit's scans and counts belong to the server, and
 * other saves may be in flight); it says the list is out of date and offers a
 * reload, which shows the audit as the server holds it.
 *
 * @see {@link file://./audit-drawer.tsx}
 */

/**
 * The server's message for a refused removal.
 *
 * Only the error's value counts: a success is answered with `error: null`, so
 * testing whether an `error` key exists would treat every removal as refused.
 *
 * @param answer - The remove request's answer (the fetcher's data)
 * @returns The message to show, or `null` when the removal went through
 */
export function refusedRemovalMessage(answer: unknown): string | null {
  if (typeof answer !== "object" || answer === null) {
    return null;
  }
  const { error } = answer as { error?: unknown };
  if (error === null || error === undefined) {
    return null;
  }
  const message =
    typeof error === "object" && "message" in error
      ? (error as { message?: unknown }).message
      : null;
  return typeof message === "string" && message
    ? message
    : "The server did not remove it.";
}
