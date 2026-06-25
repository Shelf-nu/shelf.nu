import { useRef, useCallback } from "react";
import { api } from "@/lib/api";
import { saveAuditScanState } from "@/lib/audit-scan-persistence";
import { reportAuditDurabilityEvent } from "@/lib/sentry";
import type { ScannedItem, ScanQueueEntry } from "./use-audit-init";

// ── Constants ────────────────────────────────────────────

const MAX_QUEUE_RETRIES = 3;
const RETRY_DELAYS = [2_000, 5_000, 15_000];

// ── Hook ─────────────────────────────────────────────────

type UseScanQueueParams = {
  orgId: string | undefined;
  scannedItemsRef: React.MutableRefObject<ScannedItem[]>;
  /** Called when a scan is confirmed and auditAssetId is received from server */
  onScanSynced?: (assetId: string, auditAssetId: string) => void;
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
  scannedItemsRef,
  onScanSynced,
  onScanFailed,
}: UseScanQueueParams): ScanQueueResult {
  const scanQueueRef = useRef<ScanQueueEntry[]>([]);
  const failedQueueRef = useRef<ScanQueueEntry[]>([]);
  const isProcessingQueueRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const processQueue = useCallback(async () => {
    if (isProcessingQueueRef.current || !orgId) return;
    if (scanQueueRef.current.length === 0) return;

    isProcessingQueueRef.current = true;

    while (scanQueueRef.current.length > 0) {
      const entry = scanQueueRef.current[0];
      try {
        const { data, error } = await api.recordAuditScan(orgId, entry);
        // Treat envelope errors as failures — keep item in queue for retry
        if (error || !data) {
          throw new Error(error ?? "Failed to sync audit scan");
        }
        // Success — remove from queue and persist immediately
        scanQueueRef.current.shift();

        // Capture auditAssetId from response so notes/photos can be attached
        if (data?.auditAssetId) {
          const itemIndex = scannedItemsRef.current.findIndex(
            (item) => item.assetId === entry.assetId
          );
          if (itemIndex !== -1) {
            scannedItemsRef.current[itemIndex] = {
              ...scannedItemsRef.current[itemIndex],
              auditAssetId: data.auditAssetId,
              // A successful (re)sync clears any prior failed marker.
              syncFailed: false,
            };
          }
          // Notify caller to update React state for re-render
          onScanSynced?.(entry.assetId, data.auditAssetId);
        }

        saveAuditScanState(
          entry.auditSessionId,
          scannedItemsRef.current,
          scanQueueRef.current,
          failedQueueRef.current
        );
      } catch {
        // Network error — retry with backoff
        const retries = (entry.retryCount ?? 0) + 1;
        if (retries >= MAX_QUEUE_RETRIES) {
          // Max retries reached. CRITICAL: never silently drop the scan, or an
          // asset the worker saw as "Found" is lost and later marked MISSING on
          // completion. Move it to the failed queue (persisted, re-syncable) and
          // mark the item so the UI surfaces it and completion can be blocked.
          scanQueueRef.current.shift();
          failedQueueRef.current.push({ ...entry, retryCount: undefined });
          // Mark the scanned item directly on the ref (mirrors the success path)
          // so the persisted snapshot captures the failed state on crash.
          const failedIndex = scannedItemsRef.current.findIndex(
            (item) => item.assetId === entry.assetId
          );
          if (failedIndex !== -1) {
            scannedItemsRef.current[failedIndex] = {
              ...scannedItemsRef.current[failedIndex],
              syncFailed: true,
            };
          }
          onScanFailed?.(entry.assetId);
          saveAuditScanState(
            entry.auditSessionId,
            scannedItemsRef.current,
            scanQueueRef.current,
            failedQueueRef.current
          );
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
          continue;
        } else {
          // Move to end of queue with incremented retry count
          scanQueueRef.current.shift();
          scanQueueRef.current.push({ ...entry, retryCount: retries });
          // Persist the requeued state NOW. The success and max-retry branches
          // both persist; without this one, an app kill during the backoff —
          // or a sub-2s scanning burst that perpetually resets the debounced
          // saver — loses the in-memory queue entry, so a scan the worker saw
          // as Found vanishes and is marked MISSING on completion.
          saveAuditScanState(
            entry.auditSessionId,
            scannedItemsRef.current,
            scanQueueRef.current,
            failedQueueRef.current
          );
          // Clear any prior timer before scheduling a new one, so a rapid
          // re-entry can't orphan a setTimeout that re-fires processQueue after
          // unmount (post-unmount work / double-record).
          if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
          const delay = RETRY_DELAYS[retries - 1] ?? 15_000;
          retryTimerRef.current = setTimeout(() => processQueue(), delay);
          break;
        }
      }
    }

    isProcessingQueueRef.current = false;
  }, [orgId, scannedItemsRef, onScanSynced, onScanFailed]);

  const enqueueScan = useCallback(
    (entry: ScanQueueEntry) => {
      scanQueueRef.current.push(entry);
      // Persist immediately (eager, not via the debounced saver): the scan must
      // hit disk the instant it is queued, so an app kill before the first
      // network attempt — or a sustained sub-2s scanning burst that keeps
      // resetting the debounce — can never lose it. Fire-and-forget; the
      // debounced saver remains for lower-priority UI snapshots.
      saveAuditScanState(
        entry.auditSessionId,
        scannedItemsRef.current,
        scanQueueRef.current,
        failedQueueRef.current
      );
      processQueue();
    },
    [processQueue, scannedItemsRef]
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
