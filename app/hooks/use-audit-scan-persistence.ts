import { useEffect } from "react";
import { type FetcherWithComponents } from "react-router";
import type {
  AuditSessionInfo,
  AuditScannedItem,
  ScanListItems,
} from "~/atoms/qr-scanner";

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
}: UseAuditScanPersistenceProps) {
  /**
   * Monitor scanned items and persist new ones to the database.
   */
  useEffect(() => {
    if (!auditSession || isRestoringRef.current) {
      return;
    }

    const expectedAssetIds = new Set(expectedAssets.map((asset) => asset.id));

    Object.entries(scannedItems).forEach(([qrId, item]) => {
      if (!item || !item.data || !item.type || item.error) {
        return;
      }

      const assetId = item.data.id;

      // Skip if already persisted or currently being persisted
      if (
        persistedItemsRef.current.has(assetId) ||
        pendingPersistsRef.current.has(assetId)
      ) {
        return;
      }

      // Mark as pending
      pendingPersistsRef.current.set(assetId, qrId);

      const isExpected = expectedAssetIds.has(assetId);

      const formData = new FormData();
      formData.append("auditSessionId", auditSession.id);
      formData.append("qrId", qrId);
      formData.append("assetId", assetId);
      formData.append("isExpected", String(isExpected));

      // Use React Router fetcher for POST request
      void scanPersistFetcher.submit(formData, {
        method: "POST",
        action: "/api/audits/record-scan",
      });
    });
  }, [
    scannedItems,
    auditSession,
    expectedAssets,
    scanPersistFetcher,
    persistedItemsRef,
    pendingPersistsRef,
    isRestoringRef,
  ]);

  /**
   * Track fetcher state to mark scans as successfully persisted.
   * When the fetcher completes successfully, move assets from pending to persisted.
   */
  useEffect(() => {
    if (scanPersistFetcher.state === "idle" && scanPersistFetcher.data) {
      const data = scanPersistFetcher.data as
        | { success?: boolean; data?: { scanId?: string } }
        | { error?: string };

      if ("success" in data && data.success) {
        // Mark all pending as persisted
        pendingPersistsRef.current.forEach((_qrId, assetId) => {
          persistedItemsRef.current.add(assetId);
        });
        pendingPersistsRef.current.clear();
      } else if ("error" in data && data.error) {
        // eslint-disable-next-line no-console
        console.error("Failed to persist scan:", data.error);
        // Clear pending so it can be retried
        pendingPersistsRef.current.clear();
      }
    }
  }, [
    scanPersistFetcher.state,
    scanPersistFetcher.data,
    persistedItemsRef,
    pendingPersistsRef,
  ]);
}
