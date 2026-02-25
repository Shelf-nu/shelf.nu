import type React from "react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { useFetcher } from "react-router";
import { z } from "zod";
import {
  auditSessionAtom,
  clearScannedItemsAtom,
  auditAssetMetaAtom,
  lastDuplicateScanAtom,
  removeMultipleScannedItemsAtom,
  removeScannedItemAtom,
  scannedItemsAtom,
  type AuditScannedItem,
  type AuditSessionInfo,
  type ScanListItems,
} from "~/atoms/qr-scanner";
import { AuditAssetActions } from "~/components/audit/audit-asset-actions";
import CompleteAuditDialog from "~/components/audit/complete-audit-dialog";
import { AvailabilityBadge } from "~/components/booking/availability-label";
import ImageWithPreview from "~/components/image-with-preview/image-with-preview";
import { createAvailabilityLabels } from "~/components/scanner/drawer/availability-label-factory";
import {
  createBlockers,
  type BlockerConfig,
} from "~/components/scanner/drawer/blockers-factory";
import ConfigurableDrawer from "~/components/scanner/drawer/configurable-drawer";
import {
  DefaultLoadingState,
  GenericItemRow,
  Tr,
} from "~/components/scanner/drawer/generic-item-row";
import { Button } from "~/components/shared/button";
import { Progress } from "~/components/shared/progress";
import { Spinner } from "~/components/shared/spinner";
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
  pendingScanCount?: number;
  isLoading?: boolean;
  defaultExpanded?: boolean;
  className?: string;
  style?: React.CSSProperties;
  headerContent?: React.ReactNode;
  portalContainer?: HTMLElement;
  onScanRemoved?: (assetId: string) => void;
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

/**
 * Custom footer form for audit drawer that includes Cancel button and Complete Audit dialog
 */
function AuditDrawerFooter({
  disabled,
  auditName,
  portalContainer,
  stats,
  expanded,
}: {
  disabled: boolean;
  auditName: string;
  portalContainer?: HTMLElement;
  stats: {
    expectedCount: number;
    foundCount: number;
    missingCount: number;
    unexpectedCount: number;
  };
  expanded: boolean;
}) {
  return (
    <div
      className={tw(
        "flex w-full gap-2 border-t border-gray-200 bg-white p-3",
        expanded && "sticky bottom-0"
      )}
    >
      {/* Close button */}
      <Button type="button" variant="secondary" to=".." className="ml-auto">
        Close
      </Button>
      {/* Complete Audit dialog trigger */}
      <CompleteAuditDialog
        disabled={disabled}
        auditName={auditName}
        portalContainer={portalContainer}
        stats={stats}
      />
    </div>
  );
}

export function AuditDrawer({
  contextLabel,
  contextName,
  expectedAssets,
  pendingScanCount = 0,
  isLoading,
  defaultExpanded,
  className,
  style,
  headerContent,
  portalContainer,
  onScanRemoved,
  getAdditionalBlockers,
  emptyStateContent,
}: AuditDrawerProps) {
  const items = useAtomValue(scannedItemsAtom);
  const auditSession = useAtomValue(auditSessionAtom);
  const duplicateScan = useAtomValue(lastDuplicateScanAtom);
  const [highlightedQrId, setHighlightedQrId] = useState<string | null>(null);

  // Highlight the duplicate row briefly when a duplicate scan is detected
  useEffect(() => {
    if (duplicateScan) {
      setHighlightedQrId(duplicateScan.qrId);
      const timer = setTimeout(() => setHighlightedQrId(null), 2500);
      return () => clearTimeout(timer);
    }
  }, [duplicateScan]);
  const auditAssetMeta = useAtomValue(auditAssetMetaAtom);
  const clearList = useSetAtom(clearScannedItemsAtom);
  const removeItem = useSetAtom(removeScannedItemAtom);
  const removeItemsFromList = useSetAtom(removeMultipleScannedItemsAtom);
  const removeScanFetcher = useFetcher();

  const expectedAssetIds = useMemo(
    () => new Set(expectedAssets.map((asset) => asset.id)),
    [expectedAssets]
  );
  const assetTypeBadgeClass = tw(
    "inline-block bg-gray-50 px-[6px] py-[2px]",
    "rounded-md border border-gray-200",
    "text-xs text-gray-700"
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

  // Get IDs of scanned assets for quick lookup
  const scannedAssetIds = useMemo(
    () =>
      new Set(
        Object.values(items)
          .filter((item) => !!item && item.data && item.type === "asset")
          .map((item) => (item!.data as AssetFromQr).id)
      ),
    [items]
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

  const stats: AuditDrawerStats = useMemo(
    () => ({
      totalExpected: expectedAssets.length,
      foundCount: foundAssets.length,
      missingCount: missingAssets.length,
      unexpectedCount: unexpectedAssets.length,
    }),
    [
      expectedAssets.length,
      foundAssets.length,
      missingAssets.length,
      unexpectedAssets.length,
    ]
  );

  const formData = useMemo(() => {
    if (!auditSession) return {};
    return {
      intent: "complete-audit",
      auditSessionId: auditSession.id,
      foundAssetCount: String(stats.foundCount),
      missingAssetCount: String(stats.missingCount),
      unexpectedAssetCount: String(stats.unexpectedCount),
    };
  }, [auditSession, stats]);

  const auditTitle = useMemo(() => {
    if (!auditSession) {
      return contextLabel;
    }
    return (
      <div className="text-right">
        <span className="block text-gray-600">
          Audit: {contextName} • {stats.foundCount}/{stats.totalExpected} found
          {stats.unexpectedCount > 0 &&
            ` • ${stats.unexpectedCount} unexpected`}
        </span>
        {pendingScanCount > 0 ? (
          <span className="flex items-center gap-1.5 text-xs text-gray-500">
            Saving scans: {pendingScanCount} remaining
            <Spinner className="size-3" />
          </span>
        ) : (
          <span className="flex h-5 flex-col justify-center font-medium text-gray-900">
            <Progress
              aria-label={`Audit progress: ${stats.foundCount} of ${stats.totalExpected} assets found`}
              value={
                stats.totalExpected > 0
                  ? (stats.foundCount / stats.totalExpected) * 100
                  : 0
              }
            />
          </span>
        )}
      </div>
    );
  }, [
    contextLabel,
    contextName,
    auditSession,
    pendingScanCount,
    stats.foundCount,
    stats.totalExpected,
    stats.unexpectedCount,
  ]);

  const { Blockers, hasBlockers } = useMemo(() => {
    // No base blockers - unexpected assets are allowed and tracked
    const baseBlockers: BlockerConfig[] = [];

    const additionalBlockers = getAdditionalBlockers
      ? getAdditionalBlockers({
          items,
          removeItems: removeItemsFromList,
          removeItem,
          expectedAssetIds,
        })
      : [];

    const allBlockers = [...baseBlockers, ...additionalBlockers];
    const [hasActiveBlockers, BlockersComponent] = createBlockers({
      blockerConfigs: allBlockers,
      onResolveAll: () => {
        // No automatic cleanup of unexpected assets
      },
    });
    return {
      Blockers: BlockersComponent,
      hasBlockers: hasActiveBlockers,
    };
  }, [
    getAdditionalBlockers,
    items,
    removeItemsFromList,
    removeItem,
    expectedAssetIds,
  ]);

  /**
   * Render a scanned item using GenericItemRow
   */
  const handleRemove = useCallback(
    (qrId: string) => {
      const scannedItem = items[qrId];
      if (
        auditSession &&
        scannedItem?.type === "asset" &&
        scannedItem.data?.id
      ) {
        const formData = new FormData();
        formData.append("intent", "remove-scan");
        formData.append("assetId", scannedItem.data.id);
        formData.append("qrId", qrId);

        void removeScanFetcher.submit(formData, {
          method: "post",
          action: `/audits/${auditSession.id}/scan`,
        });

        onScanRemoved?.(scannedItem.data.id);
      }

      removeItem(qrId);
    },
    [auditSession, items, onScanRemoved, removeItem, removeScanFetcher]
  );

  const renderItem = (qrId: string, item: any) => (
    <GenericItemRow
      key={qrId}
      qrId={qrId}
      item={item}
      onRemove={handleRemove}
      className={
        highlightedQrId === qrId
          ? "duration-[2500ms] bg-amber-50 transition-colors"
          : undefined
      }
      searchParams={
        auditSession ? { auditSessionId: auditSession.id } : undefined
      }
      renderLoading={(pendingQrId: string, error?: string) => (
        <DefaultLoadingState qrId={pendingQrId} error={error} />
      )}
      renderItem={(data: any) => {
        const isAsset = item?.type === "asset";
        const isExpected = isAsset && data?.id && expectedAssetIds.has(data.id);
        const isUnexpected =
          isAsset && data?.id && !expectedAssetIds.has(data.id);
        const auditAssetId =
          typeof data?.auditAssetId === "string"
            ? data.auditAssetId
            : undefined;
        // Prefer live meta counts over loader data for instant UI feedback.
        const meta = auditAssetId ? auditAssetMeta[auditAssetId] : undefined;
        const notesCount =
          meta?.notesCount ??
          (typeof data?.auditNotesCount === "number"
            ? data.auditNotesCount
            : 0);
        const imagesCount =
          meta?.imagesCount ??
          (typeof data?.auditImagesCount === "number"
            ? data.auditImagesCount
            : 0);

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
          <div className="flex items-center gap-2">
            <ImageWithPreview
              thumbnailUrl={data.thumbnailImage || data.mainImage}
              alt={data.title || "Asset"}
              className="size-[54px] rounded-[2px]"
            />
            <div className="flex flex-col gap-1">
              <Button
                asChild
                variant="link"
                className="text-left font-medium text-gray-800 hover:text-gray-700 hover:underline"
                to={`${auditAssetId}/details`}
              >
                <span className="word-break whitespace-break-spaces">
                  {"title" in data ? data.title : data.name}
                </span>
              </Button>
              <div className="flex flex-wrap items-center gap-1">
                <span className={assetTypeBadgeClass}>
                  {item.type === "asset" ? "asset" : "kit"}
                </span>
                <AuditLabels />
                {/* Action buttons for notes and images */}
                {auditSession && item.type === "asset" && data?.id && (
                  <AuditAssetActions
                    auditAssetId={data.auditAssetId || ""}
                    auditSessionId={auditSession.id}
                    assetName={
                      ("title" in data ? data.title : data.name) || "Asset"
                    }
                    isPending={false}
                    notesCount={notesCount}
                    imagesCount={imagesCount}
                  />
                )}
              </div>
            </div>
          </div>
        );
      }}
    />
  );

  /**
   * Render a pending (expected but not yet scanned) asset
   */
  const renderPendingAsset = (asset: AuditScannedItem) => (
    <Tr key={`pending-${asset.id}`} skipEntrance>
      <td className="w-full p-0 md:p-0">
        <div className="flex items-center justify-between gap-3 p-4 md:px-6">
          <div className="flex items-center gap-2">
            <ImageWithPreview
              thumbnailUrl={asset.thumbnailImage || asset.mainImage}
              alt={asset.name || "Asset"}
              className="size-[54px] rounded-[2px]"
            />

            <div className="flex flex-col gap-1">
              <Button
                asChild
                variant="link"
                className="text-left font-medium text-gray-800 hover:text-gray-700 hover:underline"
                to={`${asset.auditAssetId}/details`}
              >
                <span className="word-break whitespace-break-spaces">
                  {asset.name}
                </span>
              </Button>
              <div className="flex flex-wrap items-center gap-1">
                <span className={assetTypeBadgeClass}>asset</span>
                <AvailabilityBadge
                  badgeText="Pending"
                  tooltipTitle="Pending scan"
                  tooltipContent="This asset is expected but has not been scanned yet."
                  className="border-gray-200 bg-gray-50 text-gray-600"
                />
                {/* Action buttons for notes and images on pending assets */}
                {auditSession && (
                  <AuditAssetActions
                    auditAssetId={asset.auditAssetId || ""}
                    auditSessionId={auditSession.id}
                    assetName={asset.name}
                    isPending={true}
                    notesCount={
                      asset.auditAssetId
                        ? auditAssetMeta[asset.auditAssetId]?.notesCount ??
                          asset.auditNotesCount ??
                          0
                        : asset.auditNotesCount ?? 0
                    }
                    imagesCount={
                      asset.auditAssetId
                        ? auditAssetMeta[asset.auditAssetId]?.imagesCount ??
                          asset.auditImagesCount ??
                          0
                        : asset.auditImagesCount ?? 0
                    }
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </td>
      <td>
        {/* No remove button for pending items */}
        <div className="w-[52px]" />
      </td>
    </Tr>
  );

  /**
   * Custom renderer that shows scanned items at the top, followed by pending assets
   */
  const customRenderAllItems = (): ReactNode => {
    // Get pending (expected but not scanned) assets
    const pendingAssets = expectedAssets.filter(
      (asset) => !scannedAssetIds.has(asset.id)
    );

    // Render scanned items first, then pending assets at the bottom
    return (
      <>
        {Object.entries(items).map(([qrId, item]) => renderItem(qrId, item))}
        {pendingAssets.map((asset) => renderPendingAsset(asset))}
      </>
    );
  };

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
      customRenderAllItems={customRenderAllItems}
      Blockers={Blockers}
      disableSubmit={shouldDisableSubmit}
      defaultExpanded={defaultExpanded}
      className={className}
      style={style}
      emptyStateContent={resolvedEmptyState}
      // Render pending assets list even when no scans exist yet.
      renderWhenEmpty
      headerContent={headerContent}
      // Larger collapsed height to fit first item with larger header
      collapsedHeight={193}
      form={(expanded) => (
        <AuditDrawerFooter
          disabled={shouldDisableSubmit}
          auditName={auditSession?.name || ""}
          portalContainer={portalContainer}
          stats={{
            expectedCount: stats.totalExpected,
            foundCount: stats.foundCount,
            missingCount: stats.missingCount,
            unexpectedCount: stats.unexpectedCount,
          }}
          expanded={expanded}
        />
      )}
    />
  );
}

export default AuditDrawer;
