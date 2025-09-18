import React, { useMemo } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { z } from "zod";

import {
  auditSessionAtom,
  clearScannedItemsAtom,
  removeMultipleScannedItemsAtom,
  removeScannedItemAtom,
  scannedItemsAtom,
  type AuditScannedItem,
  type AuditSessionInfo,
  type ScanListItems,
} from "~/atoms/qr-scanner";
import { createAvailabilityLabels } from "~/components/scanner/drawer/availability-label-factory";
import {
  createBlockers,
  type BlockerConfig,
} from "~/components/scanner/drawer/blockers-factory";
import ConfigurableDrawer from "~/components/scanner/drawer/configurable-drawer";
import {
  DefaultLoadingState,
  GenericItemRow,
} from "~/components/scanner/drawer/generic-item-row";
import { Progress } from "~/components/shared/progress";
import type { AssetFromQr } from "~/routes/api+/get-scanned-item.$qrId";
import { tw } from "~/utils/tw";

const AuditSchema = z.object({
  intent: z.string(),
  auditSessionId: z.string(),
  foundAssetCount: z.string().optional(),
  missingAssetCount: z.string().optional(),
  unexpectedAssetCount: z.string().optional(),
});

export type AuditDrawerStats = {
  totalExpected: number;
  foundCount: number;
  missingCount: number;
  unexpectedCount: number;
};

type AdditionalBlockerFactoryArgs = {
  items: ScanListItems;
  removeItems: (ids: string[]) => void;
  removeItem: (id: string) => void;
  expectedAssetIds: Set<string>;
};

type AuditDrawerProps = {
  contextLabel: string;
  contextName: string;
  expectedAssets: AuditScannedItem[];
  isLoading?: boolean;
  defaultExpanded?: boolean;
  className?: string;
  style?: React.CSSProperties;
  headerContent?: React.ReactNode;
  getAdditionalBlockers?: (
    args: AdditionalBlockerFactoryArgs
  ) => BlockerConfig[];
  emptyStateContent?: (args: {
    expanded: boolean;
    auditSession: AuditSessionInfo;
    stats: AuditDrawerStats;
    contextLabel: string;
    contextName: string;
  }) => React.ReactNode;
};

export function AuditDrawer({
  contextLabel,
  contextName,
  expectedAssets,
  isLoading,
  defaultExpanded,
  className,
  style,
  headerContent,
  getAdditionalBlockers,
  emptyStateContent,
}: AuditDrawerProps) {
  const items = useAtomValue(scannedItemsAtom);
  const auditSession = useAtomValue(auditSessionAtom);
  const clearList = useSetAtom(clearScannedItemsAtom);
  const removeItem = useSetAtom(removeScannedItemAtom);
  const removeItemsFromList = useSetAtom(removeMultipleScannedItemsAtom);

  const expectedAssetIds = useMemo(
    () => new Set(expectedAssets.map((asset) => asset.id)),
    [expectedAssets]
  );

  const scannedAssets = useMemo(
    () =>
      Object.values(items)
        .filter((item) => !!item && item.data && item.type === "asset")
        .map((item) => {
          const assetData = item!.data as AssetFromQr;
          return {
            id: assetData.id,
            name: assetData.title,
            type: "asset" as const,
            auditStatus: expectedAssetIds.has(assetData.id)
              ? ("found" as const)
              : ("unexpected" as const),
          } satisfies AuditScannedItem;
        }),
    [items, expectedAssetIds]
  );

  const foundAssets = scannedAssets.filter(
    (asset) => asset.auditStatus === "found"
  );
  const unexpectedAssets = scannedAssets.filter(
    (asset) => asset.auditStatus === "unexpected"
  );
  const missingAssets = expectedAssets.filter(
    (asset) => !foundAssets.some((found) => found.id === asset.id)
  );

  const stats: AuditDrawerStats = {
    totalExpected: expectedAssets.length,
    foundCount: foundAssets.length,
    missingCount: missingAssets.length,
    unexpectedCount: unexpectedAssets.length,
  };

  const errors = Object.entries(items).filter(([, item]) => !!item?.error);
  const errorIds = errors.map(([qrId]) => qrId);
  const baseBlockers: BlockerConfig[] = [
    {
      condition: errors.length > 0,
      count: errors.length,
      message: (count) => (
        <>
          <strong>{`${count} QR code${count > 1 ? "s" : ""}`}</strong>{" "}
          {count > 1 ? "are" : "is"} invalid.
        </>
      ),
      onResolve: () => removeItemsFromList(errorIds),
    },
  ];

  const additionalBlockers = getAdditionalBlockers
    ? getAdditionalBlockers({
        items,
        removeItems: removeItemsFromList,
        removeItem,
        expectedAssetIds,
      })
    : [];

  const blockerConfigs = [...baseBlockers, ...additionalBlockers];

  const [hasBlockers, Blockers] = createBlockers({
    blockerConfigs,
    onResolveAll: () => {
      blockerConfigs
        .filter((blocker) => blocker.condition)
        .forEach((blocker) => blocker.onResolve());
    },
  });

  const auditTitle = (
    <div className="text-right">
      <span className="block text-gray-600">
        Audit: {contextName} • {stats.foundCount}/{stats.totalExpected} found
        {stats.unexpectedCount > 0 && ` • ${stats.unexpectedCount} unexpected`}
      </span>
      <span className="flex h-5 flex-col justify-center font-medium text-gray-900">
        <Progress
          value={
            stats.totalExpected > 0
              ? (stats.foundCount / stats.totalExpected) * 100
              : 0
          }
        />
      </span>
    </div>
  );

  const formData = auditSession
    ? {
        intent: "complete-audit",
        auditSessionId: auditSession.id,
        foundAssetCount: stats.foundCount.toString(),
        missingAssetCount: stats.missingCount.toString(),
        unexpectedAssetCount: stats.unexpectedCount.toString(),
      }
    : undefined;

  const renderItem = (qrId: string, item: any) => (
    <GenericItemRow
      key={qrId}
      qrId={qrId}
      item={item}
      onRemove={removeItem}
      renderItem={(data: any) => {
        const isAsset = item.type === "asset";
        const isExpected = isAsset && expectedAssetIds.has(data.id);
        const isUnexpected = isAsset && !expectedAssetIds.has(data.id);

        const availabilityConfigs = [
          {
            condition: isExpected,
            badgeText: "Expected",
            tooltipTitle: "Expected asset",
            tooltipContent:
              "This asset belongs to this audit according to records.",
            priority: 100,
            className: "border-green-200 bg-green-50 text-green-700",
          },
          {
            condition: isUnexpected,
            badgeText: "Unexpected",
            tooltipTitle: "Unexpected asset",
            tooltipContent:
              "This asset was not expected in this audit context.",
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
      renderLoading={(pendingQrId: string, error?: string) => (
        <DefaultLoadingState qrId={pendingQrId} error={error} />
      )}
    />
  );

  const resolvedEmptyState = emptyStateContent
    ? (expanded: boolean) =>
        emptyStateContent({
          expanded,
          auditSession,
          stats,
          contextLabel,
          contextName,
        })
    : (expanded: boolean) => (
        <div className="py-8 text-center">
          <p className="text-gray-500">
            {expanded
              ? `No assets scanned yet. Start scanning to audit this ${contextLabel.toLowerCase()}.`
              : `Scan assets to audit this ${contextLabel.toLowerCase()}...`}
          </p>
          {auditSession && expanded && (
            <div className="mt-4 rounded-lg bg-blue-50 p-3">
              <p className="text-sm text-blue-700">
                Audit: <strong>{contextName}</strong>
              </p>
              <p className="mt-1 text-xs text-blue-600">
                Expected: {stats.totalExpected} • Found: {stats.foundCount} •
                Unexpected: {stats.unexpectedCount}
              </p>
            </div>
          )}
        </div>
      );

  const shouldDisableSubmit =
    hasBlockers ||
    !auditSession ||
    stats.foundCount + stats.unexpectedCount === 0;

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
      disableSubmit={shouldDisableSubmit}
      submitButtonText="Complete Audit"
      defaultExpanded={defaultExpanded}
      className={className}
      style={style}
      emptyStateContent={resolvedEmptyState}
      headerContent={headerContent}
    />
  );
}

export default AuditDrawer;
