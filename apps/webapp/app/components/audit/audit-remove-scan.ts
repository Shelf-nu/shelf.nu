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
import type { AuditCount, ScanListItems } from "~/atoms/qr-scanner";
import { hasUnsavedCounts, isWaitingForCount } from "./audit-count-flow";

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

/**
 * Whether reloading the scanner would lose work the server does not hold yet:
 * a scan still saving, a count entered and not saved, or a quantity-tracked
 * scan still waiting for its count. The reload offered after a refused
 * removal waits until there is none.
 *
 * @param args.pendingScanCount - Scans not saved yet (see `countScansToSave`)
 * @param args.items - The scanned list
 * @param args.auditCounts - The counts by asset id
 * @param args.listedAssetIds - Assets on the scanned list
 * @returns `true` while a reload would drop something
 */
export function reloadWouldLoseWork({
  pendingScanCount,
  items,
  auditCounts,
  listedAssetIds,
}: {
  pendingScanCount: number;
  items: ScanListItems;
  auditCounts: Record<string, AuditCount>;
  listedAssetIds: ReadonlySet<string>;
}): boolean {
  return (
    pendingScanCount > 0 ||
    hasUnsavedCounts(auditCounts, listedAssetIds) ||
    Object.values(items).some((item) => isWaitingForCount(item, auditCounts))
  );
}
