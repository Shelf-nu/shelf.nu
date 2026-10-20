/**
 * Blocker list for the audit scan drawer.
 *
 * Unexpected assets are findings, recorded with the audit, and never block.
 * What blocks completing the audit is a scan that is not an asset: a kit
 * (audits track assets, so the operator scans the kit's assets instead) or a
 * code that resolved to nothing. Derived here as a pure function with stable
 * ids, pinned by `audit-blockers.test.tsx`.
 *
 * @see {@link file://./audit-drawer.tsx}
 * @see {@link file://../scanner/drawer/blockers-factory.tsx}
 */

import type { ScanListItems } from "~/atoms/qr-scanner";
import type { BlockerConfig } from "~/components/scanner/drawer/blockers-factory";

/**
 * The error a scanned kit is stored with in an audit (`AuditItemRow` rejects
 * kits with it). Shared so the blocker can tell a rejected kit from a code
 * that resolved to nothing.
 */
export const AUDIT_KIT_REJECTED_MESSAGE =
  "Audits track assets, not kits. Scan the kit's individual assets.";

/**
 * Builds the audit drawer's blockers.
 *
 * @param args.items - The scanned rows, keyed by the code that resolved them
 * @param args.removeItems - Drops rows by code
 * @returns The blocker list, for `createBlockers`
 */
export function buildAuditBlockers({
  items,
  removeItems,
}: {
  items: ScanListItems;
  removeItems: (qrIds: string[]) => void;
}): { blockerConfigs: BlockerConfig[] } {
  const errored = Object.entries(items).filter(([, item]) => !!item?.error);
  const kitQrIds = errored
    .filter(([, item]) => item?.error === AUDIT_KIT_REJECTED_MESSAGE)
    .map(([qrId]) => qrId);
  const invalidQrIds = errored
    .filter(([, item]) => item?.error !== AUDIT_KIT_REJECTED_MESSAGE)
    .map(([qrId]) => qrId);

  return {
    blockerConfigs: [
      {
        id: "kits-not-audited",
        condition: kitQrIds.length > 0,
        count: kitQrIds.length,
        message: (count: number) => (
          <>
            <strong>{`${count} kit${count > 1 ? "s" : ""}`}</strong>{" "}
            {count > 1 ? "were" : "was"} scanned.
          </>
        ),
        description: "Audits track assets. Scan the kit's assets instead.",
        onResolve: () => removeItems(kitQrIds),
      },
      {
        id: "invalid-codes",
        condition: invalidQrIds.length > 0,
        count: invalidQrIds.length,
        message: (count: number) => (
          <>
            <strong>{`${count} QR code${count > 1 ? "s" : ""}`}</strong>{" "}
            {count > 1 ? "are" : "is"} invalid.
          </>
        ),
        onResolve: () => removeItems(invalidQrIds),
      },
    ],
  };
}
