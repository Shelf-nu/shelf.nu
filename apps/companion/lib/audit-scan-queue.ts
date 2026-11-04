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

import { countExpectation } from "@shelf/quantity-control";

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
 * The entry to queue in place of `replaced`: when any of them was a first
 * scan (not a recount), the server may not have the scan yet, so the newest
 * count must be sent as a first scan too. Otherwise a lost first scan would
 * be reported, if it failed, as a lost count correction while the server
 * never recorded the asset.
 *
 * @param entry - the newer entry for the asset
 * @param replaced - the older counted entries for the same asset it replaces
 */
export function carryFirstScan<T extends CountedQueueEntry>(
  entry: T,
  replaced: readonly CountedQueueEntry[]
): T {
  const replacesFirstScan = replaced.some(
    (old) => isCounted(old) && sameAsset(old, entry) && old.recount !== true
  );
  return replacesFirstScan ? { ...entry, recount: false } : entry;
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
 * MIRROR of `expectedQuantityFor` in apps/webapp/app/modules/audit/quantity.ts
 * for the unexpected case: cosmetic only, the server snapshots the row itself
 * (for a location audit, the units placed at its locations). The audit's own
 * row decides for an expected asset (its snapshot). An unexpected asset has no
 * row yet, so the code lookup's asset type decides, with the asset's stock as
 * the figure; the scanner shows it to no one, because an asset not on the
 * audit's list is counted without an expectation. Extraction target:
 * `@shelf/quantity-control`.
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
 * The audit count bound and what the count sheet can promise, shared with the
 * web scanner through `@shelf/quantity-control`.
 */
export { countExpectation, MAX_AUDIT_COUNT } from "@shelf/quantity-control";

/** The count fields of an audit scan as the mobile audit endpoint returns it. */
export type ScanCountFields = {
  expectedQuantity?: number | null;
  foundQuantity?: number | null;
  unitOfMeasure?: string | null;
};

/**
 * The count fields of a restored scan row. A server without counts sends none
 * of them, and every one reads as absent (null).
 *
 * @param scan - a scan from `GET /api/mobile/audits/:id` (`existingScans`)
 */
export function countFieldsFromScan(scan: ScanCountFields): {
  expectedQuantity: number | null;
  foundQuantity: number | null;
  unitOfMeasure: string | null;
} {
  return {
    expectedQuantity: scan.expectedQuantity ?? null,
    foundQuantity: scan.foundQuantity ?? null,
    unitOfMeasure: scan.unitOfMeasure ?? null,
  };
}

/**
 * The count to show on the row after a counted scan synced: the count the
 * server answers with, which is what it stored (another one than was sent when
 * the audit was finished, or the scan removed, before a recount landed).
 * Undefined, so the row keeps its count, when the entry sent no count, the
 * server answered without one, or a newer count for the asset is still
 * queued: that newer count's own answer settles the row.
 *
 * @param sentCount - the entry's `foundQuantity`
 * @param response - the record-scan response
 * @param superseded - whether a newer count for the same asset is queued
 */
export function storedCountFor(
  sentCount: number | undefined,
  response: { foundQuantity?: number | null },
  superseded: boolean
): number | null | undefined {
  if (sentCount === undefined || response.foundQuantity === undefined) {
    return undefined;
  }
  return superseded ? undefined : response.foundQuantity;
}

/**
 * Whether the server kept another count than the scan sent, so the auditor
 * must be told the count they entered did not stick.
 *
 * @param sentCount - the entry's `foundQuantity`
 * @param storedCount - from {@link storedCountFor}
 */
export function countWasRefused(
  sentCount: number | undefined,
  storedCount: number | null | undefined
): boolean {
  return (
    sentCount !== undefined &&
    storedCount !== undefined &&
    storedCount !== sentCount
  );
}

/**
 * The value the count sheet opens with: the count already recorded, else the
 * expected units when there are some to confirm, else blank (null), so an
 * asset with nothing expected or not on the list is counted, not confirmed.
 * Mirrors the web dialog's initial value in `audit-count-dialog.tsx`.
 */
export function countSheetDefault(request: {
  isExpected: boolean;
  expectedQuantity: number;
  foundQuantity: number | null;
}): number | null {
  if (request.foundQuantity !== null) return request.foundQuantity;
  return countExpectation(request) === "expected"
    ? request.expectedQuantity
    : null;
}

/** What a scan of an asset in an audit leads to. */
export type AuditScanDecision =
  /** A listed quantity-tracked asset scanned again: correct its count. */
  | {
      kind: "recount";
      expectedQuantity: number;
      foundQuantity: number | null;
      isExpected: boolean;
      unitOfMeasure: string | null;
    }
  /** A quantity-tracked asset scanned for the first time: ask for a count. */
  | {
      kind: "first";
      expectedQuantity: number;
      isExpected: boolean;
      unitOfMeasure: string | null;
    }
  /** An asset already scanned that is not counted: "Already scanned". */
  | { kind: "duplicate" }
  /** An individual asset scanned for the first time: record it. */
  | { kind: "record"; isExpected: boolean };

/**
 * Decides what a scan in an audit leads to: a recount of an already-scanned
 * pool, a first count, a plain duplicate, or a plain record.
 *
 * @param args.scannedRow - the asset's row in the scanned list, when scanned
 * @param args.expectedRecord - the audit's row for the asset, when expected
 * @param args.lookedUp - the asset as the code lookup returned it
 * @param args.isExpected - whether the asset is on the audit's list
 */
export function auditScanDecision({
  scannedRow,
  expectedRecord,
  lookedUp,
  isExpected,
}: {
  scannedRow:
    | {
        isExpected: boolean;
        expectedQuantity?: number | null;
        foundQuantity?: number | null;
        unitOfMeasure?: string | null;
      }
    | undefined;
  expectedRecord:
    | { expectedQuantity?: number | null; unitOfMeasure?: string | null }
    | undefined;
  lookedUp: {
    type?: string;
    quantity?: number | null;
    unitOfMeasure?: string | null;
  };
  isExpected: boolean;
}): AuditScanDecision {
  const target = countTargetFor(expectedRecord, lookedUp);
  const unitOfMeasure =
    expectedRecord?.unitOfMeasure ?? lookedUp.unitOfMeasure ?? null;

  if (scannedRow) {
    const rowExpected = scannedRow.expectedQuantity ?? target;
    if (typeof rowExpected !== "number") return { kind: "duplicate" };
    return {
      kind: "recount",
      expectedQuantity: rowExpected,
      foundQuantity: scannedRow.foundQuantity ?? null,
      isExpected: scannedRow.isExpected,
      unitOfMeasure: scannedRow.unitOfMeasure ?? unitOfMeasure,
    };
  }

  if (target === null) return { kind: "record", isExpected };
  return { kind: "first", expectedQuantity: target, isExpected, unitOfMeasure };
}

/**
 * The queue entry for a recount: marked `recount` so crash recovery replays it
 * even though the server already has the scan (see `entriesToResync`).
 */
export function recountQueueEntry(args: {
  auditSessionId: string;
  qrId: string;
  assetId: string;
  isExpected: boolean;
  foundQuantity: number;
}): CountedQueueEntry & { qrId: string; isExpected: boolean } {
  return { ...args, recount: true };
}
