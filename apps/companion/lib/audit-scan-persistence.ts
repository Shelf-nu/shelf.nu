import AsyncStorage from "@react-native-async-storage/async-storage";
import { reportAuditDurabilityEvent } from "./sentry";

// ── Types ────────────────────────────────────────────────

type ScannedItem = {
  assetId: string;
  name: string;
  isExpected: boolean;
  scannedAt: string;
  /** True when this scan exhausted its sync retries and is awaiting re-sync. */
  syncFailed?: boolean;
};

type ScanQueueEntry = {
  auditSessionId: string;
  qrId: string;
  assetId: string;
  isExpected: boolean;
};

export type PersistedScanState = {
  version: 1;
  auditId: string;
  savedAt: string;
  scannedItems: ScannedItem[];
  pendingQueue: ScanQueueEntry[];
  /**
   * Scans that exhausted their retries and must NOT be silently dropped.
   * Persisted so they survive app kills and are re-queued on resume.
   * Optional for backward-compat with sessions saved before this field existed.
   */
  failedQueue?: ScanQueueEntry[];
};

// ── Storage key ──────────────────────────────────────────

const KEY_PREFIX = "shelf_audit_scan_";
const storageKey = (auditId: string) => `${KEY_PREFIX}${auditId}`;

// ── Public API ───────────────────────────────────────────

/**
 * Persist the current scan session so it survives app kills.
 * Fire-and-forget — errors are logged in dev, never thrown.
 */
export async function saveAuditScanState(
  auditId: string,
  scannedItems: ScannedItem[],
  pendingQueue: ScanQueueEntry[],
  failedQueue: ScanQueueEntry[] = []
): Promise<boolean> {
  try {
    const state: PersistedScanState = {
      version: 1,
      auditId,
      savedAt: new Date().toISOString(),
      scannedItems,
      pendingQueue,
      failedQueue,
    };
    await AsyncStorage.setItem(storageKey(auditId), JSON.stringify(state));
    return true;
  } catch (e) {
    // why: log ALWAYS, not just in __DEV__. A swallowed setItem rejection
    // (e.g. device storage full during a long offline audit) is exactly how a
    // saw-as-Found scan is silently lost. Returning false lets callers that
    // care surface it; Sentry captures it in prod so we see it without waiting
    // for a user to notice missing audit data.
    console.warn("[AuditPersistence] save failed:", e);
    reportAuditDurabilityEvent(
      "scan_persist_failed",
      { auditId, error: String(e) },
      "error"
    );
    return false;
  }
}

/**
 * Load a previously persisted scan session.
 * Returns null if nothing exists, data is corrupt, or schema version doesn't match.
 */
export async function loadAuditScanState(
  auditId: string
): Promise<PersistedScanState | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(auditId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedScanState;
    if (parsed.version !== 1) return null;
    return parsed;
  } catch (e) {
    if (__DEV__) console.warn("[AuditPersistence] load failed:", e);
    return null;
  }
}

/**
 * Remove persisted state for an audit (normal exit or completion).
 */
export async function clearAuditScanState(auditId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(storageKey(auditId));
  } catch (e) {
    if (__DEV__) console.warn("[AuditPersistence] clear failed:", e);
  }
}

// ── Debounced saver ──────────────────────────────────────

/**
 * Returns a debounced writer that batches AsyncStorage writes.
 * During rapid scanning (~1 scan every 3-5s), writes are coalesced
 * so at most one AsyncStorage write happens per `delayMs`.
 */
export function createDebouncedSaver(auditId: string, delayMs = 2000) {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    /** Schedule a debounced save. */
    save(
      scannedItems: ScannedItem[],
      pendingQueue: ScanQueueEntry[],
      failedQueue: ScanQueueEntry[] = []
    ) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        saveAuditScanState(auditId, scannedItems, pendingQueue, failedQueue);
        timer = null;
      }, delayMs);
    },

    /** Flush immediately (e.g., before unmount). Returns a promise. */
    flush(
      scannedItems: ScannedItem[],
      pendingQueue: ScanQueueEntry[],
      failedQueue: ScanQueueEntry[] = []
    ) {
      if (timer) clearTimeout(timer);
      timer = null;
      return saveAuditScanState(
        auditId,
        scannedItems,
        pendingQueue,
        failedQueue
      );
    },

    /** Cancel any pending write without saving. */
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
