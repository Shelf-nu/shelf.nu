import { useEffect, useRef } from "react";
import { auditDeletedAssetLabel } from "@shelf/labels";
import { useSetAtom } from "jotai";
import {
  startAuditSessionAtom,
  setAuditExpectedAssetsAtom,
  endAuditSessionAtom,
  scannedItemsAtom,
  type AuditScannedItem,
  type ScanListItems,
} from "~/atoms/qr-scanner";
import type { AuditScanData } from "~/modules/audit/service.server";

/**
 * One entry in the restored `scannedItemsAtom` map.
 *
 * `data` is deliberately a SUBSET of `AssetFromQr`: the audit-scan payload
 * carries only what a scanned row renders, and the row is populated from it
 * precisely so `GenericItemRow` does not have to re-fetch the asset. Anything
 * added here must come from `AuditScanData` — there is no asset to read.
 */
type RestoredScanEntry = {
  codeType: "qr";
  type: "asset";
  data: {
    id: string;
    title: string;
    /** True once the scanned asset has been deleted; the row renders inert. */
    assetDeleted: boolean;
    /**
     * Whether the scan belonged to the audit, as the SERVER resolved it.
     *
     * Needed only because a deleted asset cannot be looked up in the expected
     * list — its AuditAsset row was cascaded away with it, and its `id` here is
     * empty. For a live asset the list is still the authority.
     */
    isExpected: boolean;
    auditAssetId: string | null;
    auditNotesCount: number;
    auditImagesCount: number;
    location: { name: string } | null;
  };
};

/**
 * Audit session data loaded from the database.
 */
type AuditSessionData = {
  /** Unique identifier for the audit session */
  id: string;
  /** Human-readable name for the audit */
  name: string;
  /** Optional reference to a target entity (e.g., booking) */
  targetId: string | null;
  /** Total number of assets expected in this audit */
  expectedAssetCount: number;
  /** Number of expected assets that have been found */
  foundAssetCount: number;
  /** Number of expected assets that are still missing */
  missingAssetCount: number;
  /** Number of assets found that were not expected */
  unexpectedAssetCount: number;
  /** Additional metadata about the audit scope */
  scopeMeta: unknown;
};

/**
 * Props for the audit session initialization hook.
 */
type UseAuditSessionInitializationProps = {
  /** The audit session data from the loader */
  session: AuditSessionData;
  /** List of assets expected to be found in this audit */
  expectedItems: AuditScannedItem[];
  /** Previously scanned items to restore from the database */
  existingScans: AuditScanData[];
  /** Ref to track which items have been persisted to DB */
  persistedItemsRef: { current: Set<string> };
};

/**
 * Hook to initialize the audit session in Jotai atoms and restore existing scans.
 *
 * This hook:
 * - Initializes the audit session state in atoms on mount
 * - Sets expected assets for the audit
 * - Restores previously scanned items from the database
 * - Cleans up the session on unmount
 *
 * @param session - The audit session data from the loader
 * @param expectedItems - List of assets expected to be found in this audit
 * @param existingScans - Previously scanned items to restore from the database
 * @param persistedItemsRef - Ref to track which items have been persisted to DB
 */
export function useAuditSessionInitialization({
  session,
  expectedItems,
  existingScans,
  persistedItemsRef,
}: UseAuditSessionInitializationProps) {
  const startAuditSession = useSetAtom(startAuditSessionAtom);
  const setExpectedAssets = useSetAtom(setAuditExpectedAssetsAtom);
  const endAuditSession = useSetAtom(endAuditSessionAtom);
  const setScannedItems = useSetAtom(scannedItemsAtom);

  // Track if we've initialized for this session to avoid re-initializing
  // This is crucial because startAuditSession clears scannedItemsAtom
  const initializedSessionIdRef = useRef<string | null>(null);

  // Initialize audit session ONLY ONCE per session
  // startAuditSession clears scannedItemsAtom, so we must not call it on re-renders
  useEffect(() => {
    // Skip if already initialized for this session
    if (initializedSessionIdRef.current === session.id) {
      // Only update expected assets on re-renders (this doesn't clear scanned items)
      setExpectedAssets(expectedItems);
      return;
    }

    // Mark as initialized BEFORE calling startAuditSession
    initializedSessionIdRef.current = session.id;

    const scopeMeta =
      typeof session.scopeMeta === "object" && session.scopeMeta
        ? (session.scopeMeta as Record<string, unknown>)
        : null;

    // Initialize audit session in atoms (this clears scannedItemsAtom)
    startAuditSession({
      id: session.id,
      name: session.name,
      targetId: session.targetId,
      contextType:
        (scopeMeta?.contextType as string | undefined) ?? "SELECTION",
      contextName:
        (scopeMeta?.contextName as string | undefined) ?? session.name,
      expectedAssetCount: session.expectedAssetCount,
      foundAssetCount: session.foundAssetCount,
      missingAssetCount: session.missingAssetCount,
      unexpectedAssetCount: session.unexpectedAssetCount,
    });

    setExpectedAssets(expectedItems);

    // Restore existing scans by directly setting scanned items atom
    // We include full asset data to avoid re-fetching via GenericItemRow
    if (existingScans.length > 0) {
      const restoredItems: Record<string, RestoredScanEntry> = {};
      existingScans.forEach((scan) => {
        // A scan whose asset was deleted keeps only the title captured at scan
        // time, and its `assetId` is empty. Naming it plainly would render it
        // as an ordinary live asset — worse than the blank row it replaced,
        // because the auditor would go looking for something that no longer
        // exists. The scan ROW id is the identity that survives the asset.
        const assetDeleted = scan.assetDeleted || !scan.assetId;

        // Keyed on the scan row for deleted assets: `code` is nullable and
        // non-unique, so codeless rows would otherwise overwrite each other.
        const itemKey = assetDeleted
          ? `deleted:${scan.id || scan.code || scan.scannedAt}`
          : scan.code;

        // Add QR codes to the atom with full data so GenericItemRow doesn't re-fetch
        restoredItems[itemKey] = {
          codeType: "qr",
          type: "asset",
          data: {
            id: scan.assetId,
            title: assetDeleted
              ? auditDeletedAssetLabel(scan.assetTitle)
              : scan.assetTitle,
            assetDeleted,
            isExpected: scan.isExpected,
            auditAssetId: scan.auditAssetId,
            auditNotesCount: scan.auditNotesCount,
            auditImagesCount: scan.auditImagesCount,
            location: scan.assetLocationName
              ? { name: scan.assetLocationName }
              : null,
          },
        };
        // Mark them as already persisted so we don't try to persist again.
        // A deleted asset has no id to dedupe on and can never be re-scanned,
        // so it contributes nothing here — adding "" would collapse every such
        // row onto one entry.
        if (scan.assetId) {
          persistedItemsRef.current.add(scan.assetId);
        }
      });
      // why the cast: `ScanListItem.data` is typed as a FULL `AssetFromQr`
      // (a complete Prisma payload), but a restored row only ever has the
      // handful of fields the scan payload carries. Reconstructing the rest
      // would mean re-fetching every asset, which is the cost restoring from
      // the payload exists to avoid. The narrow type above is what keeps this
      // honest — it still catches a typo in any field the rows actually use.
      setScannedItems(restoredItems as unknown as ScanListItems);
    }
  }, [
    expectedItems,
    existingScans,
    session.expectedAssetCount,
    session.foundAssetCount,
    session.id,
    session.missingAssetCount,
    session.name,
    session.targetId,
    session.unexpectedAssetCount,
    session.scopeMeta,
    setExpectedAssets,
    setScannedItems,
    startAuditSession,
    persistedItemsRef,
  ]);

  // Cleanup only when session changes or component unmounts
  useEffect(() => {
    const currentSessionId = session.id;

    return () => {
      // Only cleanup if we're actually leaving this session
      if (initializedSessionIdRef.current === currentSessionId) {
        initializedSessionIdRef.current = null;
        endAuditSession();
      }
    };
  }, [session.id, endAuditSession]);
}
