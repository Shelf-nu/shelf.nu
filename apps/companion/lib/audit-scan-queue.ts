/**
 * Ordering rules for counts in the audit scan queue.
 *
 * A scan of a quantity-tracked asset carries `foundQuantity`, and the server
 * treats every counted scan of an already-scanned asset as a replacement. The
 * queue retries failed entries at its back, keeps exhausted ones in a failed
 * list, and replays both after a crash, so an older count can otherwise reach
 * the server after a newer one and overwrite it. These rules keep only the
 * newest count per asset in flight: the newest entry also records the scan
 * when the server has none yet, so dropping an older counted entry loses
 * nothing.
 *
 * Also holds `countTargetFor`, which decides whether a scan is counted at all.
 *
 * Pure (no React Native imports) so it runs under the Node test runner.
 *
 * @see {@link file://../hooks/use-scan-queue.ts}
 * @see {@link file://../hooks/use-audit-init.ts}
 */

/** The fields of a queued scan these rules read. */
export type CountedQueueEntry = {
  auditSessionId: string;
  assetId: string;
  /** Units counted; absent for an individual asset. */
  foundQuantity?: number;
  /** When the entry was queued (ms). Absent on entries saved by older builds. */
  queuedAt?: number;
  /** True for a recount of a scan already recorded. */
  recount?: boolean;
};

function sameAsset(a: CountedQueueEntry, b: CountedQueueEntry): boolean {
  return a.auditSessionId === b.auditSessionId && a.assetId === b.assetId;
}

function isCounted(entry: CountedQueueEntry): boolean {
  return entry.foundQuantity !== undefined;
}

/**
 * The queue with every earlier count for `incoming`'s asset removed, ready for
 * `incoming` to be appended. Entries without a count are kept.
 *
 * @param queue - entries already queued, oldest first
 * @param incoming - the entry about to be queued
 * @param keepFirst - keep `queue[0]` whatever it is: it is the request in
 *   flight, and the queue removes it by position once that request settles
 */
export function dropSupersededCounts<T extends CountedQueueEntry>(
  queue: readonly T[],
  incoming: CountedQueueEntry,
  keepFirst: boolean
): T[] {
  if (!isCounted(incoming)) return [...queue];
  return queue.filter(
    (entry, index) =>
      (keepFirst && index === 0) ||
      !(isCounted(entry) && sameAsset(entry, incoming))
  );
}

/**
 * Whether a newer count for the same asset is waiting in `others`, so this
 * entry must not be sent (again).
 */
export function isSupersededCount(
  entry: CountedQueueEntry,
  others: readonly CountedQueueEntry[]
): boolean {
  if (!isCounted(entry)) return false;
  const queuedAt = entry.queuedAt ?? 0;
  return others.some(
    (other) =>
      other !== entry &&
      isCounted(other) &&
      sameAsset(other, entry) &&
      (other.queuedAt ?? 0) > queuedAt
  );
}

/**
 * The entries to send again when a session is resumed after a crash.
 *
 * An entry for an asset the server already has is dropped, unless it is a
 * recount: a first scan that reached the server before the crash would
 * otherwise be replayed as a recount and could overwrite a count corrected
 * since, on this device or another. Of several counts for one asset only the
 * newest is kept.
 *
 * @param pending - the live queue as saved
 * @param failed - entries that exhausted their retries
 * @param serverScannedIds - assets the server already has a scan for
 */
export function entriesToResync<T extends CountedQueueEntry>(
  pending: readonly T[],
  failed: readonly T[],
  serverScannedIds: ReadonlySet<string>
): T[] {
  const candidates = [...failed, ...pending].filter(
    (entry) => !serverScannedIds.has(entry.assetId) || entry.recount === true
  );
  return candidates.filter((entry) => !isSupersededCount(entry, candidates));
}

/**
 * The expected units of a scanned asset, or null when it is not counted.
 *
 * The audit's own row decides for an expected asset (its snapshot). An
 * unexpected asset has no row yet, so the code lookup's asset type decides,
 * with the asset's stock as the expectation.
 *
 * @param expectedRow - the audit's row for the asset, when it is expected
 * @param lookedUp - the asset as the code lookup returned it
 */
export function countTargetFor(
  expectedRow: { expectedQuantity?: number | null } | undefined,
  lookedUp: { type?: string; quantity?: number | null }
): number | null {
  if (typeof expectedRow?.expectedQuantity === "number") {
    return expectedRow.expectedQuantity;
  }
  if (lookedUp.type === "QUANTITY_TRACKED") return lookedUp.quantity ?? 0;
  return null;
}

/**
 * Largest count the server stores for one audit row: the Postgres INTEGER
 * ceiling. MIRROR of `MAX_AUDIT_FOUND_QUANTITY` in
 * apps/webapp/app/modules/audit/quantity.ts; the server enforces it, this copy
 * only bounds the count sheet so a count above the expectation (a surplus) can
 * be entered. Extraction target: a pure `packages/*` audit module (none yet).
 */
export const MAX_AUDIT_COUNT = 2_147_483_647;
