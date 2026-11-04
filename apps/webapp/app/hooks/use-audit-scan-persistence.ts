import { useEffect, useReducer, useRef } from "react";
import { AssetType } from "@prisma/client";
import { type FetcherWithComponents } from "react-router";
import type {
  AuditCount,
  AuditSessionInfo,
  AuditScannedItem,
  ScanListItems,
} from "~/atoms/qr-scanner";
import type { AuditScanCountRequired } from "~/modules/audit/service.server";
import type { AssetFromQr } from "~/routes/api+/get-scanned-item.$qrId";

/**
 * Whether a scanned item is a quantity-tracked asset, and so needs a count
 * before it is saved. Restored rows carry no asset type, so a count entry
 * (seeded from the audit's rows) also marks one.
 */
export function isQuantityScan(
  data: Pick<AssetFromQr, "id"> & { type?: unknown },
  auditCounts: Record<string, AuditCount>
): boolean {
  return (
    auditCounts[data.id] !== undefined ||
    data.type === AssetType.QUANTITY_TRACKED
  );
}

/**
 * Props for the audit scan persistence hook.
 */
type UseAuditScanPersistenceProps = {
  /** Current audit session info from atoms */
  auditSession: AuditSessionInfo | null;
  /** Map of scanned items from atoms */
  scannedItems: ScanListItems;
  /** List of expected assets for this audit */
  expectedAssets: AuditScannedItem[];
  /** React Router fetcher for submitting scans */
  scanPersistFetcher: FetcherWithComponents<unknown>;
  /** Ref tracking which items are already saved */
  persistedItemsRef: { current: Set<string> };
  /** Ref tracking which items are being saved */
  pendingPersistsRef: { current: Map<string, string> };
  /** Ref to prevent persistence during initial restoration */
  isRestoringRef: { current: boolean };
  /**
   * Unit counts keyed by assetId. A quantity-tracked scan is held back until
   * its entry has a `foundQuantity`, then sent with it.
   */
  auditCounts: Record<string, AuditCount>;
  /** Called when the server refuses a scan because it needs a count. */
  onCountRequired: (request: AuditScanCountRequired) => void;
  /**
   * Called when a quantity-tracked scan is saved, with the count the server
   * stored. That is the count sent, unless the server kept another (the audit
   * finished, or the scan was removed, before a recount landed). The caller
   * adopts it so the drawer shows what is stored.
   */
  onCountSaved: (assetId: string, foundQuantity: number | null) => void;
};

/**
 * Hook to persist audit scans to the database after items are resolved.
 *
 * This hook:
 * - Watches for newly scanned items that have been resolved by GenericItemRow
 * - Submits them to the API to create AuditScan records
 * - Tracks which items are pending/persisted to avoid duplicates
 * - Skips persistence during initial restoration from the database
 *
 * The persistence only happens AFTER GenericItemRow has fetched the item data,
 * ensuring we have complete information before saving.
 *
 * @param auditSession - Current audit session info from atoms
 * @param scannedItems - Map of scanned items from atoms
 * @param expectedAssets - List of expected assets for this audit
 * @param scanPersistFetcher - React Router fetcher for submitting scans
 * @param persistedItemsRef - Ref tracking which items are already saved
 * @param pendingPersistsRef - Ref tracking which items are being saved
 * @param isRestoringRef - Ref to prevent persistence during initial restoration
 */
export function useAuditScanPersistence({
  auditSession,
  scannedItems,
  expectedAssets,
  scanPersistFetcher,
  persistedItemsRef,
  pendingPersistsRef,
  isRestoringRef,
  auditCounts,
  onCountRequired,
  onCountSaved,
}: UseAuditScanPersistenceProps) {
  // The count each in-flight scan carried, keyed by assetId. A recount saved
  // while that request is in flight differs from it, and the scan is sent again.
  const sentCountsRef = useRef(new Map<string, number | null>());
  const latestCountsRef = useRef(auditCounts);
  latestCountsRef.current = auditCounts;
  // Bumped after we mutate `persistedItemsRef` so the consuming component
  // re-renders and any derived value (e.g. pendingScanCount that reads
  // `persistedItemsRef.current.has(...)` during render) reflects the new
  // membership. Refs alone don't trigger renders, which previously left the
  // "Saving scans: N remaining" indicator stuck after the fetcher resolved.
  const [, bumpPersistedVersion] = useReducer((n: number) => n + 1, 0);
  /**
   * Monitor scanned items and persist new ones to the database.
   *
   * React Router fetchers are single-flight: each `.submit()` aborts any
   * in-flight request. So we only submit ONE item per effect run (when the
   * fetcher is idle). Subsequent renders will pick up the next item.
   */
  useEffect(() => {
    if (!auditSession || isRestoringRef.current) {
      return;
    }

    // Only submit when fetcher is idle to avoid aborting in-flight requests
    if (scanPersistFetcher.state !== "idle") {
      return;
    }

    const expectedAssetIds = new Set(expectedAssets.map((asset) => asset.id));

    // Find the first un-persisted, resolved item and submit it
    for (const [qrId, item] of Object.entries(scannedItems)) {
      if (!item || !item.data || !item.type || item.error) {
        continue;
      }

      // Defensive: audits only track assets (kits have no AuditAsset
      // record and record-scan would reject/fail on a kit id, hanging the
      // retry loop forever). The normal path already keeps kits out of
      // `scannedItems` with `data` set (see the `rejectItemType` guard in
      // `generic-item-row.tsx`), but this check stands on its own so a
      // non-asset item can never be submitted here regardless of how it
      // entered the map.
      if (item.type !== "asset") {
        continue;
      }

      const assetId = item.data.id;

      // Skip if already persisted or currently being persisted
      if (
        persistedItemsRef.current.has(assetId) ||
        pendingPersistsRef.current.has(assetId)
      ) {
        continue;
      }

      // A quantity-tracked scan waits for the count dialog.
      const isQuantity = isQuantityScan(item.data, auditCounts);
      const foundQuantity = auditCounts[assetId]?.foundQuantity ?? null;
      if (isQuantity && foundQuantity === null) {
        continue;
      }

      // Mark as pending
      pendingPersistsRef.current.set(assetId, qrId);

      const isExpected = expectedAssetIds.has(assetId);

      const formData = new FormData();
      formData.append("auditSessionId", auditSession.id);
      formData.append("qrId", qrId);
      formData.append("assetId", assetId);
      formData.append("isExpected", String(isExpected));
      // Marks a client that asks for counts. A request without it comes from a
      // page loaded before audits counted units, and is recorded uncounted.
      formData.append("countAware", "1");
      if (isQuantity && foundQuantity !== null) {
        formData.append("foundQuantity", String(foundQuantity));
      }
      sentCountsRef.current.set(assetId, isQuantity ? foundQuantity : null);

      // Submit only one item per effect run — next render will handle the rest
      void scanPersistFetcher.submit(formData, {
        method: "POST",
        action: "/api/audits/record-scan",
      });
      return;
    }
  }, [
    scannedItems,
    auditSession,
    expectedAssets,
    scanPersistFetcher,
    persistedItemsRef,
    pendingPersistsRef,
    isRestoringRef,
    auditCounts,
  ]);

  /**
   * Track fetcher state to mark scans as successfully persisted.
   * When the fetcher completes successfully, move assets from pending to persisted.
   */
  useEffect(() => {
    if (scanPersistFetcher.state === "idle" && scanPersistFetcher.data) {
      const data = scanPersistFetcher.data as
        | {
            success?: boolean;
            data?: { scanId?: string };
            foundQuantity?: number | null;
          }
        | (AuditScanCountRequired & { success: false })
        | { error?: string };

      if ("status" in data && data.status === "count-required") {
        // Nothing was saved; the scan goes back to waiting for a count.
        pendingPersistsRef.current.clear();
        sentCountsRef.current.clear();
        bumpPersistedVersion();
        onCountRequired(data);
      } else if ("success" in data && data.success) {
        const storedCount =
          "foundQuantity" in data ? data.foundQuantity : undefined;
        pendingPersistsRef.current.forEach((_qrId, assetId) => {
          const sent = sentCountsRef.current.get(assetId);
          const current = latestCountsRef.current[assetId]?.foundQuantity;
          const isCount = sent !== undefined && sent !== null;
          // The server kept another count than the one sent.
          const keptOther =
            isCount && storedCount !== undefined && storedCount !== sent;
          if (
            !keptOther &&
            sent !== undefined &&
            current !== undefined &&
            current !== sent
          ) {
            // Recounted while this request was in flight: send it again.
            return;
          }
          persistedItemsRef.current.add(assetId);
          if (isCount) {
            onCountSaved(assetId, keptOther ? storedCount ?? null : sent);
          }
        });
        pendingPersistsRef.current.clear();
        sentCountsRef.current.clear();
        // Force a re-render so consumers reading `persistedItemsRef.current`
        // during render (e.g. pendingScanCount) recompute.
        bumpPersistedVersion();
      } else if ("error" in data && data.error) {
        // eslint-disable-next-line no-console
        console.error("Failed to persist scan:", data.error);
        // Clear pending so it can be retried
        pendingPersistsRef.current.clear();
        sentCountsRef.current.clear();
        bumpPersistedVersion();
      }
    }
  }, [
    scanPersistFetcher.state,
    scanPersistFetcher.data,
    persistedItemsRef,
    pendingPersistsRef,
    onCountRequired,
    onCountSaved,
  ]);
}
