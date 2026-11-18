/**
 * Putting back a scan whose removal the server refused.
 *
 * The audit drawer drops a removed scan from its list at once and sends the
 * removal in the background. The server removes the scan in one transaction,
 * so an answer carrying an error means nothing was removed: the scan is still
 * on the audit. The list must then show it again, or the operator believes the
 * audit holds something it does not until the page is reloaded.
 *
 * @see {@link file://./audit-drawer.tsx}
 * @see {@link file://./../../routes/_layout+/audits.$auditId.scan.tsx}
 */
import type { AuditCount, ScanListItem } from "~/atoms/qr-scanner";

/** A removal sent and not answered yet: what to put back if it is refused. */
export type PendingScanRemoval = {
  /** Scanned-list key of the removed row. */
  qrId: string;
  /** The asset the scan was for. */
  assetId: string;
  /** The row as it was, so it comes back with its data. */
  item: ScanListItem;
  /** The row's count before the removal cleared it, for quantity-tracked assets. */
  count: AuditCount | undefined;
};

/**
 * Decides whether a removal's answer means the scan must be put back.
 *
 * Only the error's value counts: a success is answered with `error: null`, so
 * testing whether an `error` key exists would undo every removal.
 *
 * @param pending - The removal that was waiting, or `null`
 * @param answer - The remove request's answer (the fetcher's data)
 * @returns The removal to undo, or `null` when it went through or nothing was
 *   waiting
 */
export function refusedScanRemoval(
  pending: PendingScanRemoval | null,
  answer: unknown
): PendingScanRemoval | null {
  if (!pending || typeof answer !== "object" || answer === null) {
    return null;
  }
  const { error } = answer as { error?: unknown };
  return error !== null && error !== undefined ? pending : null;
}
