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
  /** The audit the removal was sent for. */
  auditSessionId: string;
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
 * testing whether an `error` key exists would undo every removal. A removal
 * sent for another audit than the one on screen is never put back here.
 *
 * @param pending - The removal that was waiting, or `null`
 * @param answer - The remove request's answer (the fetcher's data)
 * @param currentAuditSessionId - The audit on screen now
 * @returns The removal to undo, or `null` when it went through, nothing was
 *   waiting, or it belongs to another audit
 */
export function refusedScanRemoval(
  pending: PendingScanRemoval | null,
  answer: unknown,
  currentAuditSessionId: string | null | undefined
): PendingScanRemoval | null {
  if (
    !pending ||
    pending.auditSessionId !== currentAuditSessionId ||
    typeof answer !== "object" ||
    answer === null
  ) {
    return null;
  }
  const { error } = answer as { error?: unknown };
  return error !== null && error !== undefined ? pending : null;
}

/**
 * Whether a scan was saved on the audit when it was removed: recorded, and
 * no save of it (a first save, or a recount) still waiting for its answer.
 *
 * A refused removal puts back only such a scan as saved. Any other goes back
 * to the save queue and is sent again, which is harmless: the server answers
 * a scan it already holds as recorded, and a count replaces the stored one.
 *
 * @param assetId - The removed scan's asset
 * @param persisted - Assets whose scans the audit holds
 * @param pending - Assets with a save still waiting for its answer
 * @returns `true` when the scan was saved and nothing of it was in flight
 */
export function wasScanSaved(
  assetId: string,
  persisted: ReadonlySet<string>,
  pending: ReadonlyMap<string, unknown>
): boolean {
  return persisted.has(assetId) && !pending.has(assetId);
}
