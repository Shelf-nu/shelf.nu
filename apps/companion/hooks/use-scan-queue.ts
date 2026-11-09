import { useRef, useCallback, useEffect } from "react";
import { api } from "@/lib/api";
import { saveAuditScanState } from "@/lib/audit-scan-persistence";
import { reportAuditDurabilityEvent } from "@/lib/sentry";
import {
  carryFirstScan,
  drainScanQueue,
  dropSupersededCounts,
} from "@/lib/audit-scan-queue";
import { resolveQueueAccess } from "@/lib/scan-queue-owner";
import type { ScannedItem, ScanQueueEntry } from "./use-audit-init";

// ── Constants ────────────────────────────────────────────

const MAX_QUEUE_RETRIES = 3;
const RETRY_DELAYS = [2_000, 5_000, 15_000];

// ── Hook ─────────────────────────────────────────────────

type UseScanQueueParams = {
  orgId: string | undefined;
  /**
   * The signed-in account. The queue belongs to the first account seen here
   * (`lib/scan-queue-owner.ts`): it is saved to that account's draft, and only
   * used (scans added and sent) while that account is signed in.
   */
  userId: string | undefined;
  scannedItemsRef: React.MutableRefObject<ScannedItem[]>;
  /**
   * Called when a scan is confirmed and auditAssetId is received from server.
   * `storedCount` is the count the server stored for a counted scan, absent
   * when the scan carried no count or a newer count for the asset is queued
   * (see `storedCountFor`).
   */
  onScanSynced?: (
    assetId: string,
    /** Null when the server has no row left for the scan (it was removed). */
    auditAssetId: string | null,
    storedCount?: number | null,
    /**
     * True when the server kept another count than the one sent: the audit
     * was finished or the scan removed first, or another device's first scan
     * claimed the row. The row then shows the stored count.
     */
    countRefused?: boolean
  ) => void;
  /**
   * Called when a scan exhausts its retries. The scan is moved to `failedQueueRef`
   * (never silently dropped) so the UI can surface it and completion can be blocked.
   */
  onScanFailed?: (assetId: string) => void;
};

export type ScanQueueResult = {
  scanQueueRef: React.MutableRefObject<ScanQueueEntry[]>;
  /**
   * Scans that exhausted their retries. They are retained (not dropped) so they
   * can be re-synced and so audit completion can be blocked until empty.
   */
  failedQueueRef: React.MutableRefObject<ScanQueueEntry[]>;
  enqueueScan: (entry: ScanQueueEntry) => void;
  processQueue: () => Promise<void>;
  /** Move all failed scans back into the live queue and re-attempt sync. */
  retryFailedScans: () => void;
  retryTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
};

export function useScanQueue({
  orgId,
  userId,
  scannedItemsRef,
  onScanSynced,
  onScanFailed,
}: UseScanQueueParams): ScanQueueResult {
  const scanQueueRef = useRef<ScanQueueEntry[]>([]);
  const failedQueueRef = useRef<ScanQueueEntry[]>([]);
  const isProcessingQueueRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The account this queue belongs to; set once, on first sight. */
  const ownerRef = useRef<string | null>(null);
  /** The account signed in right now, read by the send loop between requests. */
  const signedInRef = useRef(userId);
  /** True once the screen is gone: a send loop still running stops. */
  const stoppedRef = useRef(false);

  /** Records the owner and returns what the queue may do right now. */
  const access = useCallback(() => {
    const resolved = resolveQueueAccess(ownerRef.current, userId);
    ownerRef.current = resolved.owner;
    return resolved;
  }, [userId]);

  // Record the owner as soon as an account is known, before the first scan, so
  // the queue never runs ownerless.
  useEffect(() => {
    signedInRef.current = userId;
    access();
  }, [userId, access]);

  useEffect(() => {
    stoppedRef.current = false;
    return () => {
      stoppedRef.current = true;
    };
  }, []);

  /** Whether the loop may send the next request for the owner. */
  const maySendNow = useCallback(
    () =>
      !stoppedRef.current &&
      ownerRef.current !== null &&
      signedInRef.current === ownerRef.current,
    []
  );

  /** Saves the queues as the owner's draft; nothing while no owner is known. */
  const saveDraft = useCallback(
    (auditSessionId: string) => {
      const { owner, maySave } = access();
      if (!maySave || !owner) return;
      void saveAuditScanState(
        owner,
        auditSessionId,
        scannedItemsRef.current,
        scanQueueRef.current,
        failedQueueRef.current
      );
    },
    [access, scannedItemsRef]
  );

  const processQueue = useCallback(async () => {
    if (isProcessingQueueRef.current || !orgId) return;
    if (scanQueueRef.current.length === 0) return;
    // Another account's queue stays in its owner's draft, unsent.
    if (!access().mayUse) return;

    isProcessingQueueRef.current = true;

    const persist = (entry: ScanQueueEntry) => saveDraft(entry.auditSessionId);

    // The ordering rules live in `drainScanQueue`, where they are tested.
    const { backoffAttempt } = await drainScanQueue({
      queue: scanQueueRef,
      failed: failedQueueRef,
      items: scannedItemsRef,
      recordScan: (entry) => api.recordAuditScan(orgId, entry),
      maxRetries: MAX_QUEUE_RETRIES,
      persist,
      // Each request goes out with the token of whoever is signed in when it
      // is sent, so the drain stops (scans stay in the owner's draft) once the
      // screen is gone or someone else is signed in.
      mayContinue: maySendNow,
      onSynced: onScanSynced,
      onFailed: (entry) => {
        onScanFailed?.(entry.assetId);
        // Surface to Sentry: a scan the worker saw as Found has not reached
        // the server after all retries. This is the field signal we'd
        // otherwise only learn about from a "my audit is wrong" report.
        reportAuditDurabilityEvent(
          "scan_sync_failed",
          {
            auditSessionId: entry.auditSessionId,
            assetId: entry.assetId,
            retries: MAX_QUEUE_RETRIES,
          },
          "error"
        );
        if (__DEV__)
          console.warn(
            `[AuditQueue] Scan failed after ${MAX_QUEUE_RETRIES} retries; moved to failed queue:`,
            entry.assetId
          );
      },
    });

    if (backoffAttempt !== null) {
      // Clear any prior timer before scheduling a new one, so a rapid
      // re-entry can't orphan a setTimeout that re-fires processQueue after
      // unmount (post-unmount work / double-record).
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      const delay = RETRY_DELAYS[backoffAttempt - 1] ?? 15_000;
      retryTimerRef.current = setTimeout(() => processQueue(), delay);
    }

    isProcessingQueueRef.current = false;
  }, [
    orgId,
    scannedItemsRef,
    onScanSynced,
    onScanFailed,
    access,
    saveDraft,
    maySendNow,
  ]);

  const enqueueScan = useCallback(
    (incoming: ScanQueueEntry) => {
      // A different account never adds to another account's queue.
      const { owner } = access();
      if (userId && owner && userId !== owner) return;
      const queued = { ...incoming, queuedAt: incoming.queuedAt ?? Date.now() };
      // A new count replaces any older count for the same asset still
      // waiting. The request in flight (queue head while processing) stays:
      // the queue removes it by position when it settles.
      const keptQueue = dropSupersededCounts(
        scanQueueRef.current,
        queued,
        isProcessingQueueRef.current
      );
      const keptFailed = dropSupersededCounts(
        failedQueueRef.current,
        queued,
        false
      );
      // A first scan that never reached the server makes this one a first
      // scan too.
      const entry = carryFirstScan(queued, [
        ...scanQueueRef.current.filter((old) => !keptQueue.includes(old)),
        ...failedQueueRef.current.filter((old) => !keptFailed.includes(old)),
      ]);
      // Mutate in place: a pending debounced save holds these array references.
      scanQueueRef.current.length = 0;
      scanQueueRef.current.push(...keptQueue);
      failedQueueRef.current.length = 0;
      failedQueueRef.current.push(...keptFailed);
      scanQueueRef.current.push(entry);
      // Persist immediately (eager, not via the debounced saver): the scan must
      // hit disk the instant it is queued, so an app kill before the first
      // network attempt — or a sustained sub-2s scanning burst that keeps
      // resetting the debounce — can never lose it. Fire-and-forget; the
      // debounced saver remains for lower-priority UI snapshots.
      saveDraft(entry.auditSessionId);
      processQueue();
    },
    [processQueue, saveDraft, access, userId]
  );

  const retryFailedScans = useCallback(() => {
    if (failedQueueRef.current.length === 0) return;
    // Move failed scans back into the live queue with a fresh retry budget.
    const retrying = failedQueueRef.current.map((e) => ({
      ...e,
      retryCount: 0,
    }));
    // Mutate in place — a pending debounced save holds this array reference,
    // so reassigning it would let a later write repersist already-retried scans.
    failedQueueRef.current.length = 0;
    scanQueueRef.current.push(...retrying);
    processQueue();
  }, [processQueue]);

  return {
    scanQueueRef,
    failedQueueRef,
    enqueueScan,
    processQueue,
    retryFailedScans,
    retryTimerRef,
  };
}
