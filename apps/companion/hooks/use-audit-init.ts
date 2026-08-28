import { useState, useEffect, useRef } from "react";
import { Alert, Animated } from "react-native";
import { api, type AuditExpectedAsset } from "@/lib/api";
import {
  loadAuditScanState,
  clearAuditScanState,
  createDebouncedSaver,
} from "@/lib/audit-scan-persistence";
import { auditDeletedAssetLabel } from "@shelf/labels";
import { announce } from "@/lib/a11y";
import { reportAuditDurabilityEvent } from "@/lib/sentry";

// ── Types ────────────────────────────────────────────────

export type ScannedItem = {
  assetId: string;
  name: string;
  isExpected: boolean;
  scannedAt: string;
  /**
   * The AuditScan row id, set on every scan restored from the server.
   *
   * A deleted asset's row REQUIRES it as its list key — `assetId` is empty for
   * those, so nothing else identifies the row. Absent on scans made live in
   * this session, which have not reached the server yet, and on servers too
   * old to send it.
   */
  scanId?: string;
  /**
   * The scanned asset has since been deleted, so nothing behind this row can
   * be opened or re-fetched. The name already says so; this is what the list
   * reads to keep the row from being treated as an ordinary scan.
   */
  assetDeleted?: boolean;
  /** The audit-asset record ID, needed for adding notes/photos. Set after server confirms scan. */
  auditAssetId?: string;
  /** Local count of notes added during this session (optimistic). */
  notesCount?: number;
  /** Local count of photos added during this session (optimistic). */
  imagesCount?: number;
  /**
   * True when this scan exhausted its sync retries and has not yet reached the
   * server. Surfaced in the UI and blocks audit completion until re-synced.
   */
  syncFailed?: boolean;
  /**
   * Where the asset is supposed to be. Shown on the scanned row so the tab
   * carries the same orienting detail the Not-scanned tab already does —
   * standing in a room, "which shelf" is more useful than re-reading that a
   * scan was scanned. Null when the asset has no location, or (for an
   * unexpected asset scanned live) until the server round-trip fills it in.
   */
  locationName?: string | null;
  /**
   * Thumbnail for the same reason: the Not-scanned tab shows one, so an eye
   * moving between tabs should not have to switch modes. Null when absent.
   */
  thumbnailImage?: string | null;
};

export type ScanQueueEntry = {
  auditSessionId: string;
  qrId: string;
  assetId: string;
  isExpected: boolean;
  retryCount?: number;
};

type UseAuditInitParams = {
  auditId: string | undefined;
  orgId: string | undefined;
  progressAnim: Animated.Value;
  animateProgress: (newFound: number) => void;
  processQueue: () => void;
  scanQueueRef: React.MutableRefObject<ScanQueueEntry[]>;
};

export type AuditInitResult = {
  auditName: string;
  isInitializing: boolean;
  initError: string | null;
  expectedAssetIdsRef: React.MutableRefObject<Set<string>>;
  expectedAssetMapRef: React.MutableRefObject<Map<string, AuditExpectedAsset>>;
  scannedAssetIdsRef: React.MutableRefObject<Set<string>>;
  foundCount: number;
  setFoundCount: React.Dispatch<React.SetStateAction<number>>;
  unexpectedCount: number;
  setUnexpectedCount: React.Dispatch<React.SetStateAction<number>>;
  expectedTotal: number;
  scannedItems: ScannedItem[];
  setScannedItems: React.Dispatch<React.SetStateAction<ScannedItem[]>>;
  scannedItemsRef: React.MutableRefObject<ScannedItem[]>;
  debouncedSaverRef: React.MutableRefObject<ReturnType<
    typeof createDebouncedSaver
  > | null>;
};

export function useAuditInit({
  auditId,
  orgId,
  progressAnim,
  animateProgress,
  processQueue,
  scanQueueRef,
}: UseAuditInitParams): AuditInitResult {
  const [auditName, setAuditName] = useState("");
  const [isInitializing, setIsInitializing] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);

  // O(1) lookup sets
  const expectedAssetIdsRef = useRef(new Set<string>());
  const expectedAssetMapRef = useRef(new Map<string, AuditExpectedAsset>());
  const scannedAssetIdsRef = useRef(new Set<string>());

  // Counters (optimistic)
  const [foundCount, setFoundCount] = useState(0);
  const [unexpectedCount, setUnexpectedCount] = useState(0);
  const [expectedTotal, setExpectedTotal] = useState(0);

  // Scanned items list (most recent first)
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([]);

  // Persistence (crash recovery)
  const scannedItemsRef = useRef<ScannedItem[]>([]);
  const debouncedSaverRef = useRef<ReturnType<
    typeof createDebouncedSaver
  > | null>(null);

  useEffect(() => {
    if (!auditId || !orgId) return;

    (async () => {
      setIsInitializing(true);
      setInitError(null);

      const { data, error } = await api.audit(auditId, orgId);
      if (error || !data) {
        setInitError(error || "Failed to load audit");
        setIsInitializing(false);
        return;
      }

      setAuditName(data.audit.name);
      setExpectedTotal(data.audit.expectedAssetCount);
      setFoundCount(data.audit.foundAssetCount);
      setUnexpectedCount(data.audit.unexpectedAssetCount);

      // Build O(1) lookup sets
      const expectedIds = new Set<string>();
      const expectedMap = new Map<string, AuditExpectedAsset>();
      for (const asset of data.expectedAssets) {
        expectedIds.add(asset.id);
        expectedMap.set(asset.id, asset);
      }
      expectedAssetIdsRef.current = expectedIds;
      expectedAssetMapRef.current = expectedMap;

      // Restore existing scans from server (including evidence counts)
      const scannedIds = new Set<string>();
      const restoredItems: ScannedItem[] = [];
      for (const scan of data.existingScans) {
        scannedIds.add(scan.assetId);
        // why: an expected asset already has its full record client-side, so
        // prefer it for the image; the scan payload only carries a location.
        const expected = expectedMap.get(scan.assetId);
        // A scan whose asset was deleted keeps only the title captured at scan
        // time. Naming it plainly would render it as an ordinary live asset,
        // which is worse than the blank row it replaced — the auditor would go
        // looking for something that no longer exists. Older servers omit the
        // flag, so an empty `assetId` stands in for it.
        const assetDeleted = scan.assetDeleted || !scan.assetId;
        restoredItems.push({
          assetId: scan.assetId,
          scanId: scan.id,
          assetDeleted,
          name: assetDeleted
            ? auditDeletedAssetLabel(scan.assetTitle)
            : scan.assetTitle,
          isExpected: scan.isExpected,
          scannedAt: scan.scannedAt,
          auditAssetId: scan.auditAssetId ?? undefined,
          notesCount: scan.auditNotesCount,
          imagesCount: scan.auditImagesCount,
          locationName:
            scan.assetLocationName ?? expected?.locationName ?? null,
          thumbnailImage:
            expected?.thumbnailImage ?? expected?.mainImage ?? null,
        });
      }
      scannedAssetIdsRef.current = scannedIds;
      setScannedItems(restoredItems);
      scannedItemsRef.current = restoredItems;

      // Set initial progress
      const progress =
        data.audit.expectedAssetCount > 0
          ? data.audit.foundAssetCount / data.audit.expectedAssetCount
          : 0;
      progressAnim.setValue(Math.min(progress, 1));

      // Initialize debounced saver
      debouncedSaverRef.current = createDebouncedSaver(auditId);

      // ── Crash recovery ───────────────────────────────
      const persisted = await loadAuditScanState(auditId);
      // why: gate on whether there is ANYTHING to recover (the inner check
      // below decides recover-vs-clear from scanned items OR a non-empty
      // queue), not on scannedItems alone. The eager queue-persist can write a
      // fresh queue while scannedItems is still stale/empty (the list updates
      // on a deferred render), so requiring scannedItems.length here would skip
      // recovery and drop a queued scan. The queue is the durable record.
      if (persisted) {
        // Find items that were scanned locally but not yet on the server
        const serverScannedIds = new Set(
          data.existingScans.map((s) => s.assetId)
        );
        const recoveredItems = persisted.scannedItems.filter(
          (item) => !serverScannedIds.has(item.assetId)
        );
        // Re-sync BOTH still-pending scans and scans that previously exhausted
        // their retries (failedQueue). Without the failedQueue, a scan dropped
        // after max retries would be merged back into the list as "found" but
        // never re-submitted — and then marked MISSING on completion.
        const pendingQueue = persisted.pendingQueue || [];
        const failedQueue = persisted.failedQueue || [];
        // Exclude anything the server already has: a crash after recordAuditScan
        // succeeded but before the queue-removal snapshot persisted could leave a
        // stale entry on disk; re-submitting it would double-record the scan.
        const queuedForSync = [...pendingQueue, ...failedQueue].filter(
          (entry) => !serverScannedIds.has(entry.assetId)
        );

        if (recoveredItems.length > 0 || queuedForSync.length > 0) {
          // Show recovery dialog (don't block init)
          setIsInitializing(false);
          // Usually scannedItems and the queue agree; if only the queue
          // survived (eager-persist before the list state committed), fall back
          // to its length so the copy isn't "0 unsynced scans".
          const unsyncedCount = Math.max(
            recoveredItems.length,
            queuedForSync.length
          );
          // Surface to Sentry: a previous session ended (kill/crash/background)
          // with scans that never reached the server. Recovery is about to run
          // — this tells us how often the durability net is actually catching.
          reportAuditDurabilityEvent("session_recovered", {
            auditId,
            unsyncedCount,
            recoveredItems: recoveredItems.length,
            queuedForSync: queuedForSync.length,
          });
          Alert.alert(
            "Resume Previous Session?",
            `Found ${unsyncedCount} unsynced scan${
              unsyncedCount !== 1 ? "s" : ""
            } from a previous session.`,
            [
              {
                text: "Discard",
                style: "destructive",
                onPress: () => clearAuditScanState(auditId),
              },
              {
                text: "Resume",
                onPress: () => {
                  // A queued scan may have no recovered display item — the
                  // eager persist can save a queue entry before the list state
                  // commits. Rebuild display rows for those (name from the
                  // expected-asset map, else a neutral label) so they show as
                  // scanned, count correctly, and don't leave the Complete
                  // button hidden because scannedItems stayed empty. (Codex
                  // review, PR #2586.)
                  const recoveredIds = new Set(
                    recoveredItems.map((i) => i.assetId)
                  );
                  const queuedOnlyItems: ScannedItem[] = queuedForSync
                    .filter((e) => !recoveredIds.has(e.assetId))
                    .map((e) => ({
                      assetId: e.assetId,
                      name:
                        expectedAssetMapRef.current.get(e.assetId)?.name ??
                        "Scanned asset",
                      isExpected: e.isExpected,
                      scannedAt: new Date().toISOString(),
                      locationName:
                        expectedAssetMapRef.current.get(e.assetId)
                          ?.locationName ?? null,
                      thumbnailImage:
                        expectedAssetMapRef.current.get(e.assetId)
                          ?.thumbnailImage ??
                        expectedAssetMapRef.current.get(e.assetId)?.mainImage ??
                        null,
                    }));
                  const allRecovered = [...recoveredItems, ...queuedOnlyItems];

                  // Merge recovered items into state
                  for (const item of allRecovered) {
                    scannedIds.add(item.assetId);
                  }
                  scannedAssetIdsRef.current = scannedIds;

                  const merged = [...allRecovered, ...restoredItems];
                  setScannedItems(merged);
                  scannedItemsRef.current = merged;

                  // Requeue pending + previously-failed items for submission
                  if (queuedForSync.length > 0) {
                    scanQueueRef.current = queuedForSync.map((e) => ({
                      ...e,
                      retryCount: 0,
                    }));
                    // processQueue will be called after this callback
                    setTimeout(() => processQueue(), 100);
                  }

                  // Recalculate counters
                  let extraFound = 0;
                  let extraUnexpected = 0;
                  for (const item of allRecovered) {
                    if (item.isExpected) extraFound++;
                    else extraUnexpected++;
                  }
                  if (extraFound > 0) {
                    setFoundCount((prev) => prev + extraFound);
                    animateProgress(data.audit.foundAssetCount + extraFound);
                  }
                  if (extraUnexpected > 0) {
                    setUnexpectedCount((prev) => prev + extraUnexpected);
                  }

                  announce(
                    `Resumed ${allRecovered.length} scan${
                      allRecovered.length !== 1 ? "s" : ""
                    } from previous session`
                  );
                },
              },
            ]
          );
          return; // Skip the setIsInitializing below
        } else {
          // Server already has everything — clear stale state
          clearAuditScanState(auditId);
        }
      }

      setIsInitializing(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditId, orgId, progressAnim]);

  return {
    auditName,
    isInitializing,
    initError,
    expectedAssetIdsRef,
    expectedAssetMapRef,
    scannedAssetIdsRef,
    foundCount,
    setFoundCount,
    unexpectedCount,
    setUnexpectedCount,
    expectedTotal,
    scannedItems,
    setScannedItems,
    scannedItemsRef,
    debouncedSaverRef,
  };
}
