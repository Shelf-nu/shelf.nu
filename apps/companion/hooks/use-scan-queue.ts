import { useRef, useCallback } from "react";
import { api } from "@/lib/api";
import { saveAuditScanState } from "@/lib/audit-scan-persistence";
import type { ScannedItem, ScanQueueEntry } from "./use-audit-init";

// ── Constants ────────────────────────────────────────────

const MAX_QUEUE_RETRIES = 3;
const RETRY_DELAYS = [2_000, 5_000, 15_000];

// ── Hook ─────────────────────────────────────────────────

type UseScanQueueParams = {
  orgId: string | undefined;
  scannedItemsRef: React.MutableRefObject<ScannedItem[]>;
};

export type ScanQueueResult = {
  scanQueueRef: React.MutableRefObject<ScanQueueEntry[]>;
  enqueueScan: (entry: ScanQueueEntry) => void;
  processQueue: () => Promise<void>;
  retryTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
};

export function useScanQueue({
  orgId,
  scannedItemsRef,
}: UseScanQueueParams): ScanQueueResult {
  const scanQueueRef = useRef<ScanQueueEntry[]>([]);
  const isProcessingQueueRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const processQueue = useCallback(async () => {
    if (isProcessingQueueRef.current || !orgId) return;
    if (scanQueueRef.current.length === 0) return;

    isProcessingQueueRef.current = true;

    while (scanQueueRef.current.length > 0) {
      const entry = scanQueueRef.current[0];
      try {
        await api.recordAuditScan(orgId, entry);
        // Success — remove from queue and persist immediately
        scanQueueRef.current.shift();
        saveAuditScanState(
          entry.auditSessionId,
          scannedItemsRef.current,
          scanQueueRef.current
        );
      } catch {
        // Network error — retry with backoff
        const retries = (entry.retryCount ?? 0) + 1;
        if (retries >= MAX_QUEUE_RETRIES) {
          // Max retries reached — skip this item, move to next
          scanQueueRef.current.shift();
          saveAuditScanState(
            entry.auditSessionId,
            scannedItemsRef.current,
            scanQueueRef.current
          );
          if (__DEV__)
            console.warn(
              `[AuditQueue] Giving up on scan after ${MAX_QUEUE_RETRIES} retries:`,
              entry.assetId
            );
          continue;
        } else {
          // Move to end of queue with incremented retry count
          scanQueueRef.current.shift();
          scanQueueRef.current.push({ ...entry, retryCount: retries });
          // Schedule retry with backoff
          const delay = RETRY_DELAYS[retries - 1] ?? 15_000;
          retryTimerRef.current = setTimeout(() => processQueue(), delay);
          break;
        }
      }
    }

    isProcessingQueueRef.current = false;
  }, [orgId, scannedItemsRef]);

  const enqueueScan = useCallback(
    (entry: ScanQueueEntry) => {
      scanQueueRef.current.push(entry);
      processQueue();
    },
    [processQueue]
  );

  return {
    scanQueueRef,
    enqueueScan,
    processQueue,
    retryTimerRef,
  };
}
