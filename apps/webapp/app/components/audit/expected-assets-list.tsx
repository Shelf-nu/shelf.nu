import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { CheckCircle2, Clock } from "lucide-react";

import { scannedItemsAtom, type AuditScannedItem } from "~/atoms/qr-scanner";
import type { AuditDrawerStats } from "~/components/audit/audit-drawer";
import { tw } from "~/utils/tw";

type ExpectedAssetsListProps = {
  expectedAssets: AuditScannedItem[];
  stats: AuditDrawerStats;
  contextLabel: string;
  contextName: string;
};

/**
 * Displays a list of expected assets for the audit with visual indicators
 * showing which assets have been found, which are still missing, and any unexpected assets.
 */
export function ExpectedAssetsList({
  expectedAssets,
  stats,
  contextLabel,
  contextName,
}: ExpectedAssetsListProps) {
  const scannedItems = useAtomValue(scannedItemsAtom);

  // Create a set of scanned asset IDs for quick lookup
  const scannedAssetIds = useMemo(
    () =>
      new Set(
        Object.values(scannedItems)
          .filter((item) => !!item && item.data && item.type === "asset")
          .map((item) => item!.data!.id)
      ),
    [scannedItems]
  );

  // Categorize expected assets into found and missing
  const { foundAssets, missingAssets } = useMemo(() => {
    const found: AuditScannedItem[] = [];
    const missing: AuditScannedItem[] = [];

    expectedAssets.forEach((asset) => {
      if (scannedAssetIds.has(asset.id)) {
        found.push(asset);
      } else {
        missing.push(asset);
      }
    });

    return { foundAssets: found, missingAssets: missing };
  }, [expectedAssets, scannedAssetIds]);

  return (
    <div className="flex flex-col gap-4">
      {/* Header with context info */}
      <div className="rounded-lg bg-blue-50 p-3">
        <p className="text-sm font-medium text-blue-900">
          Auditing: <strong>{contextName}</strong>
        </p>
        <p className="mt-1 text-xs text-blue-700">
          Expected: {stats.totalExpected} • Found: {stats.foundCount} • Missing:{" "}
          {stats.missingCount}
          {stats.unexpectedCount > 0 && (
            <span className="text-warning-700">
              {" "}
              • Unexpected: {stats.unexpectedCount}
            </span>
          )}
        </p>
      </div>

      {/* Instructions */}
      <div className="text-center">
        <p className="text-sm text-color-600">
          {stats.foundCount === 0
            ? `Start scanning assets to begin auditing this ${contextLabel.toLowerCase()}.`
            : `Keep scanning! ${stats.missingCount} asset${
                stats.missingCount === 1 ? "" : "s"
              } remaining.`}
        </p>
      </div>

      {/* Expected assets list */}
      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-color-500">
          Expected Assets ({expectedAssets.length})
        </h3>

        <div className="max-h-96 space-y-1 overflow-y-auto rounded-md border border-color-200 bg-surface">
          {expectedAssets.length === 0 ? (
            <div className="p-4 text-center text-sm text-color-500">
              No expected assets for this audit.
            </div>
          ) : (
            <>
              {/* Show found assets first */}
              {foundAssets.map((asset) => (
                <div
                  key={asset.id}
                  className={tw(
                    "border-color-100 flex items-center justify-between gap-2 border-b px-3 py-2",
                    "last:border-b-0"
                  )}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <CheckCircle2 className="size-5 shrink-0 text-green-600" />
                    <span className="truncate text-sm font-medium text-color-900">
                      {asset.name}
                    </span>
                  </div>
                  <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                    Found
                  </span>
                </div>
              ))}

              {/* Show missing assets */}
              {missingAssets.map((asset) => (
                <div
                  key={asset.id}
                  className={tw(
                    "border-color-100 flex items-center justify-between gap-2 border-b px-3 py-2",
                    "last:border-b-0"
                  )}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <Clock className="size-5 shrink-0 text-color-400" />
                    <span className="truncate text-sm text-color-600">
                      {asset.name}
                    </span>
                  </div>
                  <span className="shrink-0 rounded-full bg-color-100 px-2 py-0.5 text-xs font-medium text-color-600">
                    Pending
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Show unexpected assets if any */}
      {stats.unexpectedCount > 0 && (
        <div className="rounded-lg border border-warning-200 bg-warning-50 p-3">
          <p className="text-sm font-medium text-warning-900">
            ⚠️ {stats.unexpectedCount} unexpected asset
            {stats.unexpectedCount === 1 ? "" : "s"} scanned
          </p>
          <p className="mt-1 text-xs text-warning-700">
            These assets were not expected in this audit but were scanned.
          </p>
        </div>
      )}
    </div>
  );
}
