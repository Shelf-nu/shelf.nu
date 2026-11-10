/**
 * Crash-recovery drafts for audit scans that have not reached the server yet.
 *
 * A draft belongs to the account that made the scans: its key and its record
 * both carry that account's user id, so on a shared device one member can
 * never load, replay or discard another member's unsynced scans. A draft for
 * another account is left in place, not deleted; its owner gets it back on
 * their next sign-in. The server-switch teardown still clears every draft by
 * the shared key prefix.
 *
 * @see {@link file://./audit-scan-persistence.test.ts}
 * @see {@link file://./../hooks/use-audit-init.ts}
 * @see {@link file://./../hooks/use-scan-queue.ts}
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { reportAuditDurabilityEvent } from "./sentry";
import { AUDIT_SCAN_KEY_PREFIX } from "./server/contract";

// ── Types ────────────────────────────────────────────────

type ScannedItem = {
  assetId: string;
  name: string;
  isExpected: boolean;
  scannedAt: string;
  /** True when this scan exhausted its sync retries and is awaiting re-sync. */
  syncFailed?: boolean;
  /** Units expected and counted, for a quantity-tracked asset. */
  expectedQuantity?: number | null;
  foundQuantity?: number | null;
  unitOfMeasure?: string | null;
};

type ScanQueueEntry = {
  auditSessionId: string;
  qrId: string;
  assetId: string;
  isExpected: boolean;
  /** Units counted, for a quantity-tracked asset. */
  foundQuantity?: number;
  /** When the entry was queued (ms). */
  queuedAt?: number;
  /** True for a recount of a scan already recorded. */
  recount?: boolean;
};

/** A persisted draft, as stored under {@link storageKey}. */
export type PersistedScanState = {
  version: 2;
  auditId: string;
  /** Supabase user id of the account that made these scans. */
  userId: string;
  savedAt: string;
  scannedItems: ScannedItem[];
  pendingQueue: ScanQueueEntry[];
  /**
   * Scans that exhausted their retries and must NOT be silently dropped.
   * Persisted so they survive app kills and are re-queued on resume.
   * Optional: a draft with nothing failed may omit it.
   */
  failedQueue?: ScanQueueEntry[];
};

// ── Storage key ──────────────────────────────────────────

// why: the prefix lives in server/contract.ts, not here, because the
// server-switch teardown must clear these drafts by prefix and cannot import
// this module (that would be a require cycle via ./sentry). Importing the
// single definition keeps the writer and the teardown from ever drifting.
// The prefix stays first so the teardown's prefix match still finds every
// draft, whoever owns it.
const storageKey = (userId: string, auditId: string) =>
  `${AUDIT_SCAN_KEY_PREFIX}${userId}:${auditId}`;

// ── Public API ───────────────────────────────────────────

/**
 * Persist the current scan session so it survives app kills.
 * Fire-and-forget: errors are logged and reported, never thrown.
 *
 * @param userId - The signed-in account that made the scans
 * @param auditId - The audit session the scans belong to
 * @param scannedItems - The scanned rows on screen
 * @param pendingQueue - Scans still waiting to sync
 * @param failedQueue - Scans that exhausted their retries
 * @returns True when the draft was written
 */
export async function saveAuditScanState(
  userId: string,
  auditId: string,
  scannedItems: ScannedItem[],
  pendingQueue: ScanQueueEntry[],
  failedQueue: ScanQueueEntry[] = []
): Promise<boolean> {
  try {
    const state: PersistedScanState = {
      version: 2,
      auditId,
      userId,
      savedAt: new Date().toISOString(),
      scannedItems,
      pendingQueue,
      failedQueue,
    };
    await AsyncStorage.setItem(
      storageKey(userId, auditId),
      JSON.stringify(state)
    );
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
 * Load the signed-in account's draft for an audit.
 *
 * @param userId - The signed-in account
 * @param auditId - The audit session to recover
 * @returns The draft, or null when nothing exists, the data is corrupt, the
 *   schema version does not match, or the draft names another account or
 *   audit. A draft that names someone else is left in place.
 */
export async function loadAuditScanState(
  userId: string,
  auditId: string
): Promise<PersistedScanState | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId, auditId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isDraftOf(parsed, userId, auditId)) return null;
    return parsed;
  } catch (e) {
    if (__DEV__) console.warn("[AuditPersistence] load failed:", e);
    return null;
  }
}

/**
 * Whether a parsed value is a well-formed draft of this account and audit.
 *
 * @param value - The parsed JSON
 * @param userId - The account it must belong to
 * @param auditId - The audit it must be for
 * @returns True when every field recovery reads has the right shape
 */
function isDraftOf(
  value: unknown,
  userId: string,
  auditId: string
): value is PersistedScanState {
  if (typeof value !== "object" || value === null) return false;
  const draft = value as Partial<PersistedScanState>;
  return (
    draft.version === 2 &&
    draft.userId === userId &&
    draft.auditId === auditId &&
    isListOf(draft.scannedItems, isScannedItem) &&
    isListOf(draft.pendingQueue, isQueueEntry) &&
    (draft.failedQueue === undefined ||
      isListOf(draft.failedQueue, isQueueEntry))
  );
}

/**
 * Whether a value is an array whose every element passes `check`.
 *
 * @param value - The value to test
 * @param check - The element test
 * @returns True for an array of valid elements (an empty array included)
 */
function isListOf(value: unknown, check: (item: unknown) => boolean): boolean {
  return Array.isArray(value) && value.every(check);
}

/**
 * Whether a value has the fields recovery reads from a scanned row.
 *
 * @param item - A parsed list element
 * @returns True when it can be shown and counted
 */
function isScannedItem(item: unknown): boolean {
  if (typeof item !== "object" || item === null) return false;
  const row = item as Partial<ScannedItem>;
  return (
    typeof row.assetId === "string" &&
    typeof row.name === "string" &&
    typeof row.isExpected === "boolean"
  );
}

/**
 * Whether a value is absent or a finite number.
 *
 * @param value - The field value
 * @returns True for undefined, null or a finite number
 */
function isOptionalNumber(value: unknown): boolean {
  return value === undefined || value === null || Number.isFinite(value);
}

/**
 * Whether a value is absent or a unit count (a finite number, zero or more).
 * Null is refused: the server takes the count as optional, not nullable.
 *
 * @param value - The field value
 * @returns True for undefined or a count
 */
function isOptionalCount(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "number" && Number.isFinite(value) && value >= 0)
  );
}

/**
 * Whether a value has the fields recovery reads from a queued scan.
 *
 * @param item - A parsed list element
 * @returns True when it can be re-sent
 */
function isQueueEntry(item: unknown): boolean {
  if (typeof item !== "object" || item === null) return false;
  const entry = item as Partial<ScanQueueEntry> & { retryCount?: unknown };
  return (
    typeof entry.auditSessionId === "string" &&
    typeof entry.qrId === "string" &&
    typeof entry.assetId === "string" &&
    typeof entry.isExpected === "boolean" &&
    // Optional fields are replayed as they are, so a wrong type would make the
    // server refuse the scan on every retry.
    isOptionalCount(entry.foundQuantity) &&
    (entry.recount === undefined || typeof entry.recount === "boolean") &&
    isOptionalNumber(entry.queuedAt) &&
    isOptionalNumber(entry.retryCount)
  );
}

/**
 * Remove the signed-in account's draft for an audit (normal exit or
 * completion). Other accounts' drafts are untouched.
 *
 * @param userId - The signed-in account
 * @param auditId - The audit session whose draft is removed
 */
export async function clearAuditScanState(
  userId: string,
  auditId: string
): Promise<void> {
  try {
    await AsyncStorage.removeItem(storageKey(userId, auditId));
  } catch (e) {
    if (__DEV__) console.warn("[AuditPersistence] clear failed:", e);
  }
}

/**
 * How long a draft with nothing left to sync is kept before
 * {@link pruneStaleAuditDrafts} drops it.
 */
export const AUDIT_DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60_000;

/**
 * Removes drafts nobody needs.
 *
 * - A draft with no owning account (saved under the audit id alone) is never
 *   offered. With nothing left to sync it is removed; while it still holds
 *   unsent scans it is kept (reported to Sentry once), because it may be the
 *   only copy of them.
 * - A draft of any account with nothing left to sync, saved more than
 *   {@link AUDIT_DRAFT_MAX_AGE_MS} ago, is removed, so a shared device does
 *   not keep finished drafts forever. A draft that still holds unsent scans
 *   is kept however old it is: it stays until its owner resumes or discards
 *   it (or a server switch clears every draft).
 *
 * Best-effort: errors are logged in dev, never thrown.
 *
 * @param now - The current time in milliseconds
 */
export async function pruneStaleAuditDrafts(now = Date.now()): Promise<void> {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((key) =>
      key.startsWith(AUDIT_SCAN_KEY_PREFIX)
    );
    const stale: string[] = [];
    for (const key of keys) {
      const raw = await AsyncStorage.getItem(key);
      let value: unknown = null;
      try {
        value = raw ? JSON.parse(raw) : null;
      } catch {
        stale.push(key);
        continue;
      }
      // JSON `null`, a number or an array is no draft at all.
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        stale.push(key);
        continue;
      }
      const parsed = value as Partial<PersistedScanState> & {
        version?: number;
      };
      const unsynced =
        (Array.isArray(parsed.pendingQueue) ? parsed.pendingQueue.length : 0) +
        (Array.isArray(parsed.failedQueue) ? parsed.failedQueue.length : 0);
      if (parsed.version !== 2 || !parsed.userId) {
        if (unsynced === 0) {
          stale.push(key);
          continue;
        }
        // Unsent scans with no recorded owner: nothing can say whose they
        // are, so they are never offered, but they are not deleted either.
        // Reported once, so the case is visible.
        const record = parsed as typeof parsed & { unownedReported?: boolean };
        if (!record.unownedReported) {
          reportAuditDurabilityEvent(
            "unowned_draft_kept",
            { auditId: parsed.auditId ?? "unknown", unsynced },
            "warning"
          );
          await AsyncStorage.setItem(
            key,
            JSON.stringify({ ...record, unownedReported: true })
          );
        }
        continue;
      }
      if (unsynced > 0) continue;
      const savedAt = Date.parse(parsed.savedAt ?? "");
      if (!Number.isFinite(savedAt) || now - savedAt > AUDIT_DRAFT_MAX_AGE_MS) {
        stale.push(key);
      }
    }
    if (stale.length > 0) await AsyncStorage.removeMany(stale);
  } catch (e) {
    if (__DEV__) console.warn("[AuditPersistence] prune failed:", e);
  }
}

/**
 * Adopts a draft saved by an older build (no owning account, stored under the
 * audit id alone) into the signed-in account's draft for that audit, so its
 * unsent scans go through the normal recovery prompt.
 *
 * Only an account that may scan this audit adopts: the scans can only have
 * come from someone working on it, and the server records them against
 * whoever replays them (the resume prompt says so). A draft is adopted only
 * when it still holds unsent scans and the account has no draft of its own
 * for this audit.
 *
 * @param userId - The signed-in account
 * @param auditId - The audit being opened
 * @param options.mayScan - Whether the account may scan this audit
 * @returns True when a draft was adopted
 */
export async function adoptUnownedDraft(
  userId: string,
  auditId: string,
  { mayScan }: { mayScan: boolean }
): Promise<boolean> {
  if (!mayScan) return false;
  try {
    const legacyKey = `${AUDIT_SCAN_KEY_PREFIX}${auditId}`;
    const raw = await AsyncStorage.getItem(legacyKey);
    if (!raw) return false;
    if (await AsyncStorage.getItem(storageKey(userId, auditId))) return false;
    const legacy = JSON.parse(raw) as Partial<PersistedScanState> | null;
    if (!legacy || legacy.auditId !== auditId) return false;
    const pendingQueue = legacy.pendingQueue ?? [];
    const failedQueue = legacy.failedQueue ?? [];
    if (pendingQueue.length + failedQueue.length === 0) return false;
    const adopted = await saveAuditScanState(
      userId,
      auditId,
      legacy.scannedItems ?? [],
      pendingQueue,
      failedQueue
    );
    // The adopted copy is validated by the normal loader; the legacy key goes
    // only once the copy is on disk.
    if (adopted) await AsyncStorage.removeItem(legacyKey);
    return adopted;
  } catch (e) {
    if (__DEV__) console.warn("[AuditPersistence] adopt failed:", e);
    return false;
  }
}

/**
 * Guards the recovery alert's buttons. A native alert can stay on screen after
 * the scanner that raised it is gone (the audit, workspace or account
 * changed); a button pressed then must do nothing, or it would resume old
 * scans into a new scanner or discard someone else's draft.
 *
 * @param isCancelled - True once the load that raised the alert was cancelled
 * @param actions - What Resume and Discard do while the alert is current
 * @returns The guarded button handlers
 */
export function guardRecoveryActions(
  isCancelled: () => boolean,
  actions: { resume: () => void; discard: () => void }
): { onResume: () => void; onDiscard: () => void } {
  return {
    onResume: () => {
      if (!isCancelled()) actions.resume();
    },
    onDiscard: () => {
      if (!isCancelled()) actions.discard();
    },
  };
}

// ── Debounced saver ──────────────────────────────────────

/**
 * Returns a debounced writer that batches AsyncStorage writes.
 * During rapid scanning (~1 scan every 3-5s), writes are coalesced
 * so at most one AsyncStorage write happens per `delayMs`.
 *
 * @param userId - The signed-in account the drafts belong to
 * @param auditId - The audit session being scanned
 * @param delayMs - The debounce window
 * @returns `save`, `flush`, `cancel` and `clear`, all bound to that account
 */
export function createDebouncedSaver(
  userId: string,
  auditId: string,
  delayMs = 2000
) {
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
        saveAuditScanState(
          userId,
          auditId,
          scannedItems,
          pendingQueue,
          failedQueue
        );
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
        userId,
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

    /**
     * Cancel any pending write and remove this account's draft. Bound to the
     * account the saver was created for, so it still clears the right draft
     * after the session has ended.
     */
    clear() {
      if (timer) clearTimeout(timer);
      timer = null;
      return clearAuditScanState(userId, auditId);
    },
  };
}
