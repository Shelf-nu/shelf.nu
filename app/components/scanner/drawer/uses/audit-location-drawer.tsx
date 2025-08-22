import { useAtomValue, useSetAtom } from "jotai";
import { z } from "zod";
import {
  auditSessionAtom,
  clearScannedItemsAtom,
  removeScannedItemAtom,
  removeMultipleScannedItemsAtom,
  scannedItemsAtom,
} from "~/atoms/qr-scanner";
import type {
  AssetFromQr,
  KitFromQr,
} from "~/routes/api+/get-scanned-item.$qrId";
import { createBlockers } from "../blockers-factory";
import ConfigurableDrawer from "../configurable-drawer";
import { GenericItemRow, DefaultLoadingState } from "../generic-item-row";
import { Progress } from "~/components/shared/progress";
import { createAvailabilityLabels } from "../availability-label-factory";
import type { AvailabilityLabelConfig } from "../availability-label-factory";
import { tw } from "~/utils/tw";

// Schema for audit form submission
const AuditSchema = z.object({
  intent: z.string(),
  auditSessionId: z.string(),
  foundAssetCount: z.string().optional(),
  missingAssetCount: z.string().optional(),
  unexpectedAssetCount: z.string().optional(),
});

/**
 * Drawer component for location audit management
 */
export default function AuditLocationDrawer({
  className,
  style,
  isLoading,
  defaultExpanded = false,
  location,
  expectedAssets = [],
}: {
  className?: string;
  style?: React.CSSProperties;
  isLoading?: boolean;
  defaultExpanded?: boolean;
  location: { id: string; name: string };
  expectedAssets?: Array<{ id: string; name: string }>;
}) {
  // Get the scanned items from jotai
  const items = useAtomValue(scannedItemsAtom);
  const auditSession = useAtomValue(auditSessionAtom);
  const clearList = useSetAtom(clearScannedItemsAtom);
  const removeItem = useSetAtom(removeScannedItemAtom);
  const removeItemsFromList = useSetAtom(removeMultipleScannedItemsAtom);

  // Calculate audit progress
  const scannedAssets = Object.values(items)
    .filter((item) => !!item && item.data && item.type === "asset")
    .map((item) => item?.data as AssetFromQr);

  const expectedAssetIds = new Set(expectedAssets.map((asset) => asset.id));
  const foundAssets = scannedAssets.filter((asset) =>
    expectedAssetIds.has(asset.id)
  );
  const unexpectedAssets = scannedAssets.filter(
    (asset) => !expectedAssetIds.has(asset.id)
  );

  const totalExpected = expectedAssets.length;
  const foundCount = foundAssets.length;
  const unexpectedCount = unexpectedAssets.length;

  // Setup blockers - for audit, we might want to block kits
  const errors = Object.entries(items).filter(([, item]) => !!item?.error);

  // Kit blockers - kits can't be audited in location context
  const kitQrIds = Object.entries(items)
    .filter(([, item]) => item?.type === "kit")
    .map(([qrId]) => qrId);

  // Create blockers configuration (only for kits and errors, not unexpected assets)
  const blockerConfigs = [
    {
      condition: kitQrIds.length > 0,
      count: kitQrIds.length,
      message: (count: number) => (
        <>
          <strong>{`${count} kit${count > 1 ? "s" : ""}`}</strong> detected.
          Kits cannot be audited in location context.
        </>
      ),
      description: "Note: Only individual assets can be audited for locations.",
      onResolve: () => removeItemsFromList(kitQrIds),
    },
    {
      condition: errors.length > 0,
      count: errors.length,
      message: (count: number) => (
        <>
          <strong>{`${count} QR code${count > 1 ? "s" : ""}`}</strong>{" "}
          {count > 1 ? "are" : "is"} invalid.
        </>
      ),
      onResolve: () => removeItemsFromList(errors.map(([qrId]) => qrId)),
    },
  ];

  // Create blockers component
  const [hasBlockers, Blockers] = createBlockers({
    blockerConfigs,
    onResolveAll: () => {},
  });

  // Form data for submission
  const formData = auditSession
    ? {
        intent: "complete-audit",
        auditSessionId: auditSession.id,
        foundAssetCount: Object.keys(items).length.toString(),
        missingAssetCount: "0", // This would be calculated differently
        unexpectedAssetCount: "0", // This would be calculated differently
      }
    : undefined;

  // Render item function
  const renderItem = (qrId: string, item: any) => (
    <GenericItemRow
      key={qrId}
      qrId={qrId}
      item={item}
      onRemove={removeItem}
      renderItem={(data: AssetFromQr | KitFromQr) => {
        const isAsset = item.type === "asset";
        const isExpected =
          isAsset && expectedAssetIds.has((data as AssetFromQr).id);
        const isUnexpected =
          isAsset && !expectedAssetIds.has((data as AssetFromQr).id);

        // Create availability labels for audit status
        const availabilityConfigs: AvailabilityLabelConfig[] = [
          {
            condition: isExpected,
            badgeText: "Expected",
            tooltipTitle: "Expected asset",
            tooltipContent:
              "This asset belongs to this location according to records.",
            priority: 100,
            className: "border-green-200 bg-green-50 text-green-700",
          },
          {
            condition: isUnexpected,
            badgeText: "Unexpected",
            tooltipTitle: "Unexpected asset",
            tooltipContent:
              "This asset was not expected in this location. It may belong to a different location or be unassigned.",
            priority: 90,
            className: "border-red-200 bg-red-50 text-red-700",
          },
        ];

        const [, AuditLabels] = createAvailabilityLabels(availabilityConfigs);

        return (
          <div className="flex flex-col gap-1">
            <p className="word-break whitespace-break-spaces font-medium">
              {"title" in data ? data.title : data.name}
            </p>
            <div className="flex flex-wrap items-center gap-1">
              <span
                className={tw(
                  "inline-block bg-gray-50 px-[6px] py-[2px]",
                  "rounded-md border border-gray-200",
                  "text-xs text-gray-700"
                )}
              >
                {item.type === "asset" ? "asset" : "kit"}
              </span>
              <AuditLabels />
            </div>
          </div>
        );
      }}
      renderLoading={(qrId: string, error?: string) => (
        <DefaultLoadingState qrId={qrId} error={error} />
      )}
    />
  );

  // Create dynamic title with progress
  const auditTitle = (
    <div className="text-right">
      <span className="block text-gray-600">
        Audit: {location.name} • {foundCount}/{totalExpected} found
        {unexpectedCount > 0 && ` • ${unexpectedCount} unexpected`}
      </span>
      <span className="flex h-5 flex-col justify-center font-medium text-gray-900">
        <Progress
          value={totalExpected > 0 ? (foundCount / totalExpected) * 100 : 0}
        />
      </span>
    </div>
  );

  return (
    <ConfigurableDrawer
      schema={AuditSchema}
      formData={formData}
      items={items}
      onClearItems={clearList}
      title={auditTitle}
      isLoading={isLoading}
      renderItem={renderItem}
      Blockers={Blockers}
      disableSubmit={
        hasBlockers || !auditSession || Object.keys(items).length === 0
      }
      submitButtonText="Complete Audit"
      defaultExpanded={defaultExpanded}
      className={className}
      style={style}
      emptyStateContent={(expanded: boolean) => (
        <div className="text-center py-8">
          <p className="text-gray-500">
            {expanded
              ? "No assets scanned yet. Start scanning to audit this location."
              : "Scan assets to audit this location..."}
          </p>
          {auditSession && expanded && (
            <div className="mt-4 p-3 bg-blue-50 rounded-lg">
              <p className="text-sm text-blue-700">
                Audit: <strong>{location.name}</strong>
              </p>
              <p className="text-xs text-blue-600 mt-1">
                Expected: {totalExpected} • Found: {foundCount} • Unexpected:{" "}
                {unexpectedCount}
              </p>
            </div>
          )}
        </div>
      )}
    />
  );
}
