/**
 * Audit Count Flow
 *
 * The decisions the web audit scanner makes around unit counts, as pure
 * functions of the scanned list and `auditCountsAtom`:
 *
 * - which scan asks for its first count next (one dialog at a time),
 * - which scans are still waiting for a count, and so are not "saving",
 * - what a recount of a listed asset opens,
 * - whether an entered count is still unsaved, which holds "Complete audit".
 *
 * An asset on the audit's list counts against its snapshot ("All here (14)").
 * An asset that is not on the list has no expectation the auditor can confirm,
 * so its prompt asks for a plain count.
 *
 * @see {@link file://./../../routes/_layout+/audits.$auditId.scan.tsx}
 * @see {@link file://./audit-drawer.tsx}
 * @see {@link file://./audit-count-dialog.tsx}
 */

import type {
  AuditCount,
  AuditCountPrompt,
  ScanListItem,
  ScanListItems,
} from "~/atoms/qr-scanner";
import { isQuantityScan } from "~/hooks/use-audit-scan-persistence";

/** The asset fields of a resolved scan these decisions read. */
type ScannedAssetData = {
  id: string;
  title: string;
  type?: unknown;
  quantity?: number | null;
  unitOfMeasure?: string | null;
};

/** The resolved asset of a scanned list entry, or null for anything else. */
function scannedAsset(item: ScanListItem | undefined): ScannedAssetData | null {
  if (!item?.data || item.error || item.type !== "asset") return null;
  const data = item.data as Partial<ScannedAssetData>;
  if (!data.id) return null;
  return { title: "Asset", ...data } as ScannedAssetData;
}

/** Whether a count has been entered for this asset. */
function hasCount(count: AuditCount | undefined): boolean {
  return count?.foundQuantity !== null && count?.foundQuantity !== undefined;
}

/**
 * Whether a scanned entry is a quantity-tracked asset with no count yet: it is
 * held back from saving until the auditor counts it.
 *
 * @param item - one entry of the scanned list
 * @param auditCounts - the counts by asset id
 */
export function isWaitingForCount(
  item: ScanListItem | undefined,
  auditCounts: Record<string, AuditCount>
): boolean {
  const asset = scannedAsset(item);
  if (!asset) return false;
  return isQuantityScan(asset, auditCounts) && !hasCount(auditCounts[asset.id]);
}

/**
 * How many resolved scans are not saved yet. A scan waiting for its count is
 * not counted: nothing is being saved for it.
 *
 * @param scannedItems - the scanned list, keyed by code
 * @param auditCounts - the counts by asset id
 * @param savedAssetIds - assets whose scan the server already has
 */
export function countScansToSave(
  scannedItems: ScanListItems,
  auditCounts: Record<string, AuditCount>,
  savedAssetIds: ReadonlySet<string>
): number {
  return Object.values(scannedItems).filter((item) => {
    if (!item?.data?.id || item.error) return false;
    if (savedAssetIds.has(item.data.id)) return false;
    return !isWaitingForCount(item, auditCounts);
  }).length;
}

/**
 * The first-count prompt for the next scan that needs one, or null when none
 * does. Scans are asked in list order, one at a time.
 *
 * @param args.scannedItems - the scanned list, keyed by code
 * @param args.auditCounts - the counts by asset id
 * @param args.savedAssetIds - assets whose scan the server already has
 * @param args.expectedAssetIds - assets on the audit's list
 */
export function nextFirstCountPrompt({
  scannedItems,
  auditCounts,
  savedAssetIds,
  expectedAssetIds,
}: {
  scannedItems: ScanListItems;
  auditCounts: Record<string, AuditCount>;
  savedAssetIds: ReadonlySet<string>;
  expectedAssetIds: ReadonlySet<string>;
}): AuditCountPrompt | null {
  for (const [qrId, item] of Object.entries(scannedItems)) {
    const asset = scannedAsset(item);
    if (!asset || savedAssetIds.has(asset.id)) continue;
    if (!isWaitingForCount(item, auditCounts)) continue;
    const count = auditCounts[asset.id];
    return {
      assetId: asset.id,
      qrId,
      assetTitle: asset.title,
      expectedQuantity: count?.expectedQuantity ?? asset.quantity ?? 0,
      foundQuantity: null,
      unitOfMeasure: count?.unitOfMeasure ?? asset.unitOfMeasure ?? null,
      isExpected: expectedAssetIds.has(asset.id),
      mode: "first",
    };
  }
  return null;
}

/**
 * The prompt that corrects the count of a listed quantity-tracked asset, or
 * null when the asset has no count entry (an individual asset): the scan is
 * then an ordinary duplicate.
 *
 * @param args.assetId - the scanned asset
 * @param args.qrId - the list entry the asset is listed under
 * @param args.assetTitle - the asset's title, for the dialog
 * @param args.auditCounts - the counts by asset id
 * @param args.expectedAssetIds - assets on the audit's list
 */
export function recountPromptFor({
  assetId,
  qrId,
  assetTitle,
  auditCounts,
  expectedAssetIds,
}: {
  assetId: string;
  qrId: string;
  assetTitle: string;
  auditCounts: Record<string, AuditCount>;
  expectedAssetIds: ReadonlySet<string>;
}): AuditCountPrompt | null {
  const count = auditCounts[assetId];
  if (!count) return null;
  return {
    assetId,
    qrId,
    assetTitle,
    expectedQuantity: count.expectedQuantity,
    foundQuantity: count.foundQuantity,
    unitOfMeasure: count.unitOfMeasure,
    isExpected: expectedAssetIds.has(assetId),
    // Recount: closing it keeps the scan, whatever its count.
    mode: "recount",
  };
}

/**
 * Whether closing the prompt without a count drops the scan: a first count
 * does (the scan is not saved without one), a recount keeps the saved scan.
 */
export function cancelDiscardsScan(prompt: AuditCountPrompt): boolean {
  return prompt.mode === "first";
}

/**
 * Whether a count the auditor entered has not been saved yet. It holds
 * "Complete audit": completing first would print the previous count.
 */
export function hasUnsavedCounts(
  auditCounts: Record<string, AuditCount>
): boolean {
  return Object.values(auditCounts).some((count) => count.unsaved === true);
}
