import { useEffect } from "react";
import { useSetAtom } from "jotai";
import {
  startAuditSessionAtom,
  setAuditExpectedAssetsAtom,
  endAuditSessionAtom,
  scannedItemsAtom,
  type AuditScannedItem,
} from "~/atoms/qr-scanner";
import type { AuditScanData } from "~/modules/audit/service.server";

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

  useEffect(() => {
    const scopeMeta =
      typeof session.scopeMeta === "object" && session.scopeMeta
        ? (session.scopeMeta as Record<string, unknown>)
        : null;

    // Initialize audit session in atoms
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
   // We bypass the addItem validation by directly setting the atom
   if (existingScans.length > 0) {
      const restoredItems: any = {};
     existingScans.forEach((scan) => {
        // Add QR codes to the atom with minimal data - GenericItemRow will fetch full details
        restoredItems[scan.code] = {
          codeType: "qr",
          type: "asset",
        };
        // Mark them as already persisted so we don't try to persist again
        persistedItemsRef.current.add(scan.assetId);
      });
      setScannedItems(restoredItems);
    }

    return () => {
      endAuditSession();
    };
  }, [
    endAuditSession,
    existingScans,
    expectedItems,
    session.expectedAssetCount,
    session.foundAssetCount,
    session.id,
    session.missingAssetCount,
    session.name,
    session.targetId,
    session.unexpectedAssetCount,
    session.scopeMeta,
    setScannedItems,
    setExpectedAssets,
    startAuditSession,
    persistedItemsRef,
  ]);
}
