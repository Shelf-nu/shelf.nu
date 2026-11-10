import { useRef, useCallback, useEffect } from "react";
import { accountGeneration, api } from "@/lib/api";
import { saveAuditScanState } from "@/lib/audit-scan-persistence";
import { reportAuditDurabilityEvent } from "@/lib/sentry";
import {
  carryFirstScan,
  drainScanQueue,
  dropSupersededCounts,
} from "@/lib/audit-scan-queue";
import {
  createQueueGate,
  drainMayContinue,
  type QueueGate,
} from "@/lib/scan-queue-owner";
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
  /**
   * Queues a scan, saves it to the owner's draft and starts sending it.
   *
   * @returns True when the scan was queued; false when the queue refused it
   *   (nobody, or another account than the owner, is signed in). The scan
   *   screen counts a scan as recorded only on true.
   */
  enqueueScan: (entry: ScanQueueEntry) => boolean;
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
  /**
   * The queue's ownership rules (`lib/scan-queue-owner.ts`, tested): the first
   * account seen owns it; scans are added and sent only while that account is
   * signed in; drafts always go to the owner. A drain keeps sending after the
   * screen closes and stops when the account changes (`drainMayContinue`).
   */
  const gateRef = useRef<QueueGate | null>(null);
  if (!gateRef.current) gateRef.current = createQueueGate();
  const gate = gateRef.current;
  /** False once the screen is gone: no new retry timer starts after that. */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** Saves the queues as the owner's draft; nothing while no owner is known. */
  const saveDraft = useCallback(
    (auditSessionId: string) => {
      const owner = gate.owner();
      if (!gate.maySave() || !owner) return;
      void saveAuditScanState(
        owner,
        auditSessionId,
        scannedItemsRef.current,
        scanQueueRef.current,
        failedQueueRef.current
      );
    },
    [gate, scannedItemsRef]
  );

  const processQueue = useCallback(async () => {
    if (isProcessingQueueRef.current || !orgId) return;
    if (scanQueueRef.current.length === 0) return;
    // Another account's queue stays in its owner's draft, unsent.
    if (!gate.mayUse()) return;

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
      // is sent, so the drain stops (scans stay in the owner's draft) as soon
      // as the owner's session is over. It keeps sending after the screen
      // closes, within that session.
      mayContinue: drainMayContinue(gate, accountGeneration),
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
      // After the screen closed, nothing could clear a new timer: the scans
      // stay in the owner's draft and are sent when the audit is reopened.
      if (mountedRef.current) {
        retryTimerRef.current = setTimeout(() => processQueue(), delay);
      }
    }

    isProcessingQueueRef.current = false;
  }, [orgId, scannedItemsRef, onScanSynced, onScanFailed, saveDraft, gate]);

  // Record the owner as soon as an account is known, before the first scan.
  // When the owner is signed in again after a pause (the drain stops while
  // nobody or someone else is signed in), resume sending the queue.
  useEffect(() => {
    const wasAllowed = gate.mayUse();
    gate.observe(userId, accountGeneration.current());
    // Only a change from refused to allowed restarts sending; a retry backoff
    // already scheduled keeps its own timing.
    if (
      !wasAllowed &&
      gate.mayUse() &&
      !retryTimerRef.current &&
      scanQueueRef.current.length > 0
    ) {
      void processQueue();
    }
  }, [gate, userId, processQueue]);

  const enqueueScan = useCallback(
    (incoming: ScanQueueEntry) => {
      // Only the owner, signed in, adds scans: never another account, and
      // never a signed-out scanner into the previous owner's draft.
      if (!gate.mayUse()) return false;
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
      return true;
    },
    [processQueue, saveDraft, gate]
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
