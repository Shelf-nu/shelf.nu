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

import { countExpectation, countPromptDefault } from "@shelf/quantity-control";

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
 * The value the count sheet opens with. The rule is shared with the web
 * dialog through `@shelf/quantity-control`.
 */
export const countSheetDefault = countPromptDefault;

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

/** A recount the auditor confirmed, waiting for the server's answer. */
export type PendingRecount = {
  assetTitle: string;
  /** The count the auditor typed. */
  entered: number;
  expectedQuantity: number;
  isExpected: boolean;
};

/**
 * The toast for a recount once the server has answered. A recount is never
 * reported as saved before that: a finished audit or a removed scan keeps the
 * stored count, and the auditor must see that, not a success.
 *
 * @param pending - what the auditor confirmed
 * @param storedCount - the count the server stored (`storedCountFor`);
 *   undefined when a newer count for the asset will answer instead
 * @returns the toast, or null when this answer settles nothing
 */
export function recountAnswerToast(
  pending: PendingRecount,
  storedCount: number | null | undefined
): { type: "found" | "error"; title: string; subtitle: string } | null {
  if (storedCount === undefined) return null;
  const title = pending.assetTitle;
  if (storedCount === pending.entered) {
    return {
      type: "found",
      title,
      subtitle:
        countExpectation(pending) === "expected"
          ? `Count updated · ${storedCount} of ${pending.expectedQuantity}`
          : `Count updated · ${storedCount}`,
    };
  }
  return {
    type: "error",
    title,
    subtitle:
      storedCount === null
        ? "Count not saved: the scan is no longer in this audit"
        : `Count not saved: the audit kept ${storedCount}`,
  };
}

// ── Queue replay ──────────────────────────────────────────

/** A queued scan, with the retry count the replay keeps on it. */
export type ReplayQueueEntry = CountedQueueEntry & { retryCount?: number };

/** The fields of a scanned row the replay updates when its scan syncs. */
export type ReplayScannedItem = {
  assetId: string;
  auditAssetId?: string | null;
  syncFailed?: boolean;
  foundQuantity?: number | null;
};

/** What the server answered for one queued scan. */
export type ReplayAnswer = {
  data?: { auditAssetId?: string | null; foundQuantity?: number | null } | null;
  error?: string | null;
};

/**
 * A React ref's shape. The replay reads `current` again after every request,
 * because the screen may replace the array while one is in flight.
 */
export type ReplayRef<T> = { current: T };

/** Arguments for {@link drainScanQueue}. */
export type DrainScanQueueArgs<
  E extends ReplayQueueEntry,
  I extends ReplayScannedItem,
> = {
  /** The live queue; its array is mutated in place (a pending save holds it). */
  queue: ReplayRef<E[]>;
  /** Scans that exhausted their retries; mutated in place. */
  failed: ReplayRef<E[]>;
  /** The scanned rows, updated when a scan syncs or fails. */
  items: ReplayRef<I[]>;
  /** Sends one scan. A thrown error counts as a failed attempt. */
  recordScan: (entry: E) => Promise<ReplayAnswer>;
  /** Attempts before a scan moves to `failed`. */
  maxRetries: number;
  /** Saves the queues and rows; called after every change to them. */
  persist: (entry: E) => void;
  /** A scan synced; see `onScanSynced` in `use-scan-queue.ts`. */
  onSynced?: (
    assetId: string,
    auditAssetId: string | null,
    storedCount?: number | null,
    countRefused?: boolean
  ) => void;
  /** A scan exhausted its retries and moved to `failed`. */
  onFailed?: (entry: E) => void;
  /**
   * Checked before every send; false stops the drain with the rest of the
   * queue left in place (no backoff). The hook uses it to stop once the queue
   * owner's session is over (a sign-out, another account, a server switch).
   */
  mayContinue?: () => boolean;
};

/**
 * Sends the queued scans in order until the queue is empty or an attempt
 * fails and must wait. The processing loop of `use-scan-queue.ts`, kept here
 * so its ordering rules are tested without React:
 *
 * - a synced scan leaves the queue and its row takes the server's row id and,
 *   unless a newer count for the asset is still queued, the stored count;
 * - a failed scan with a newer count for the same asset queued is dropped, not
 *   retried, so it can never land after that count; when it was the asset's
 *   first scan, the newer counts carry the first scan (`carryFirstScan`);
 * - any other failed scan goes to the back of the queue with one more retry,
 *   and the loop stops so the caller can wait before the next attempt;
 * - a scan out of retries moves to `failed` and its row is marked, never
 *   dropped.
 *
 * @returns the attempt number to back off for, or null when the queue drained
 *   (or every remaining scan moved to `failed`)
 */
export async function drainScanQueue<
  E extends ReplayQueueEntry,
  I extends ReplayScannedItem,
>({
  queue,
  failed,
  items,
  recordScan,
  maxRetries,
  persist,
  onSynced,
  onFailed,
  mayContinue,
}: DrainScanQueueArgs<E, I>): Promise<{ backoffAttempt: number | null }> {
  while (queue.current.length > 0) {
    if (mayContinue && !mayContinue()) return { backoffAttempt: null };
    const entry = queue.current[0];
    let answer: ReplayAnswer | null = null;
    try {
      answer = await recordScan(entry);
    } catch {
      answer = null;
    }
    const data = answer && !answer.error ? answer.data : null;

    if (data) {
      queue.current.shift();
      // The count the server stored, unless a newer count for this asset is
      // still queued and will settle the row itself.
      const storedCount = storedCountFor(
        entry.foundQuantity,
        data,
        isSupersededCount(entry, [...queue.current, ...failed.current])
      );
      // A count answer without a row (the scan was removed) still reaches the
      // caller, so a refused recount is always reported.
      if (data.auditAssetId || storedCount !== undefined) {
        const rows = items.current;
        const index = rows.findIndex((item) => item.assetId === entry.assetId);
        if (index !== -1) {
          rows[index] = {
            ...rows[index],
            ...(data.auditAssetId ? { auditAssetId: data.auditAssetId } : {}),
            // A successful (re)sync clears any prior failed marker.
            syncFailed: false,
            ...(storedCount !== undefined
              ? { foundQuantity: storedCount }
              : {}),
          };
        }
        onSynced?.(
          entry.assetId,
          data.auditAssetId ?? null,
          storedCount,
          countWasRefused(entry.foundQuantity, storedCount)
        );
      }
      persist(entry);
      continue;
    }

    // A newer count for this asset is queued: this one must not land after
    // it, so it is dropped rather than retried.
    if (
      isSupersededCount(entry, [...queue.current.slice(1), ...failed.current])
    ) {
      queue.current.shift();
      // This failed entry may have been the asset's first scan: the newer
      // counts then carry it.
      for (const list of [queue.current, failed.current]) {
        list.forEach((other, index) => {
          list[index] = carryFirstScan(other, [entry]);
        });
      }
      persist(entry);
      continue;
    }

    const retries = (entry.retryCount ?? 0) + 1;
    if (retries >= maxRetries) {
      // Never silently drop the scan, or an asset the worker saw as Found is
      // lost and later marked MISSING on completion. Move it to the failed
      // queue (persisted, re-syncable) and mark its row.
      queue.current.shift();
      failed.current.push({ ...entry, retryCount: undefined });
      const rows = items.current;
      const index = rows.findIndex((item) => item.assetId === entry.assetId);
      if (index !== -1) rows[index] = { ...rows[index], syncFailed: true };
      onFailed?.(entry);
      persist(entry);
      continue;
    }

    // Back of the queue with one more retry; the caller waits, then calls
    // again.
    queue.current.shift();
    queue.current.push({ ...entry, retryCount: retries });
    persist(entry);
    return { backoffAttempt: retries };
  }

  return { backoffAttempt: null };
}
