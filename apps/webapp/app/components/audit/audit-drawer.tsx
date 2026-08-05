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
import { renderAuditItems } from "~/components/audit/audit-item-row";
import CompleteAuditDialog from "~/components/audit/complete-audit-dialog";
import {
  createBlockers,
  type BlockerConfig,
} from "~/components/scanner/drawer/blockers-factory";
import ConfigurableDrawer from "~/components/scanner/drawer/configurable-drawer";
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

/** Props for {@link AuditDrawerTitle}. */
type AuditDrawerTitleProps = {
  /** Human-readable name of the audited context (location/kit/selection). */
  contextName: string;
  /** Number of expected assets that have been found so far. */
  foundCount: number;
  /** Total number of expected assets in this audit. */
  totalExpected: number;
  /** Number of scanned assets that were not expected. */
  unexpectedCount: number;
  /** Count of resolved scans still being persisted to the database. */
  pendingScanCount: number;
};

/**
 * Drawer title shown while an audit session is active: a summary line plus
 * either a "saving scans" indicator (while persists are in flight) or a
 * progress bar of found-vs-expected assets.
 *
 * @param props - See {@link AuditDrawerTitleProps}.
 * @returns The active-audit drawer title node.
 */
function AuditDrawerTitle({
  contextName,
  foundCount,
  totalExpected,
  unexpectedCount,
  pendingScanCount,
}: AuditDrawerTitleProps) {
  return (
    <div className="text-right">
      <span className="block text-gray-600">
        Audit: {contextName} • {foundCount}/{totalExpected} found
        {unexpectedCount > 0 && ` • ${unexpectedCount} unexpected`}
      </span>
      {pendingScanCount > 0 ? (
        <span className="flex items-center gap-1.5 text-xs text-gray-500">
          Saving scans: {pendingScanCount} remaining
          <Spinner className="size-3" />
        </span>
      ) : (
        <span className="flex h-5 flex-col justify-center font-medium text-gray-900">
          <Progress
            aria-label={`Audit progress: ${foundCount} of ${totalExpected} assets found`}
            value={totalExpected > 0 ? (foundCount / totalExpected) * 100 : 0}
          />
        </span>
      )}
    </div>
  );
}

/** Props for {@link AuditDrawerEmptyState}. */
type AuditDrawerEmptyStateProps = {
  /** Whether the drawer is currently expanded (affects copy + extra panel). */
  expanded: boolean;
  /**
   * Optional caller-provided empty-state renderer. When present it takes
   * precedence over the default empty state below.
   */
  customEmptyState?: AuditDrawerProps["emptyStateContent"];
  /** The active audit session, or `null` when none is in progress. */
  auditSession: AuditSessionInfo;
  /** Aggregate audit counts, surfaced in the expanded info panel. */
  stats: AuditDrawerStats;
  /** Label of the audited context type (e.g. "Location"). */
  contextLabel: string;
  /** Human-readable name of the audited context. */
  contextName: string;
};

/**
 * Empty-state content for the audit drawer. Delegates to a caller-provided
 * renderer when supplied; otherwise renders the default prompt (plus, when
 * expanded during an active session, a small audit summary panel).
 *
 * @param props - See {@link AuditDrawerEmptyStateProps}.
 * @returns The empty-state node.
 */
function AuditDrawerEmptyState({
  expanded,
  customEmptyState,
  auditSession,
  stats,
  contextLabel,
  contextName,
}: AuditDrawerEmptyStateProps) {
  if (customEmptyState) {
    return customEmptyState({
      expanded,
      auditSession,
      stats,
      contextLabel,
      contextName,
    });
  }

  return (
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
}

/**
 * Bottom drawer for an in-progress audit scan session.
 *
 * Renders the live list of scanned items (via {@link AuditItemRow}) and the
 * still-expected-but-unscanned assets (via {@link AuditPendingRow}), a progress
 * title, an empty state, and a footer with completion controls — all inside a
 * shared `ConfigurableDrawer`. Reads scan state from the audit Jotai atoms.
 *
 * @param props - See {@link AuditDrawerProps}.
 * @param props.contextLabel - Entity-type label for the audit (e.g. "Location").
 * @param props.contextName - Name of the entity being audited.
 * @param props.expectedAssets - Assets expected to be found in this audit.
 * @param props.pendingScanCount - Count of scans still being processed.
 * @param props.onScanRemoved - Called when a scanned item is removed from the list.
 * @param props.getAdditionalBlockers - Supplies extra "cannot complete" blockers.
 * @param props.emptyStateContent - Overrides the default empty-state render.
 * @returns The audit scan drawer.
 */
export default function AuditDrawer({
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

  /** Duration of the row-highlight animation after a duplicate scan. */
  const HIGHLIGHT_DURATION_MS = 2500;

  /**
   * Derive the currently highlighted row at render time from the duplicate
   * scan atom's timestamp — if the timestamp is within the highlight window
   * we show the highlight, otherwise we don't. The companion effect only
   * schedules a single re-render at the window boundary via an "expiry"
   * counter bump, so no cascading state transitions happen in reaction to
   * the atom change.
   */
  const [, setHighlightExpiryTick] = useState(0);
  const now = Date.now();
  const highlightedQrId =
    duplicateScan && now - duplicateScan.timestamp < HIGHLIGHT_DURATION_MS
      ? duplicateScan.qrId
      : null;

  useEffect(() => {
    if (!duplicateScan) return;
    const remaining =
      HIGHLIGHT_DURATION_MS - (Date.now() - duplicateScan.timestamp);
    if (remaining <= 0) return;
    const timer = setTimeout(() => {
      // Single state update — forces a re-render so the derived
      // `highlightedQrId` above becomes `null`.
      setHighlightExpiryTick((tick) => tick + 1);
    }, remaining);
    return () => clearTimeout(timer);
    // `highlightExpiryTick` intentionally excluded — it only exists to force
    // re-renders when the highlight window ends and does not affect
    // scheduling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duplicateScan]);
  const auditAssetMeta = useAtomValue(auditAssetMetaAtom);
  const clearList = useSetAtom(clearScannedItemsAtom);
  const removeItem = useSetAtom(removeScannedItemAtom);
  const removeItemsFromList = useSetAtom(removeMultipleScannedItemsAtom);
  const removeScanFetcher = useFetcher();

  // Show location when the audit is not already scoped to a specific location
  const showLocation = contextLabel.toLowerCase() !== "location";

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
      <AuditDrawerTitle
        contextName={contextName}
        foundCount={stats.foundCount}
        totalExpected={stats.totalExpected}
        unexpectedCount={stats.unexpectedCount}
        pendingScanCount={pendingScanCount}
      />
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
   * Persist the removal of a scanned asset (when part of an audit session) and
   * drop it from the local scanned-items list.
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

  /**
   * Custom renderer that shows scanned items at the top, followed by pending
   * assets. Delegates to the shared {@link renderAuditItems} helper so the
   * keyed rows remain the direct children of `<AnimatePresence>`.
   */
  const customRenderAllItems = (): ReactNode =>
    renderAuditItems({
      items,
      expectedAssets,
      scannedAssetIds,
      onRemove: handleRemove,
      highlightedQrId,
      auditSession,
      expectedAssetIds,
      auditAssetMeta,
      showLocation,
    });

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
      emptyStateContent={(expanded) => (
        <AuditDrawerEmptyState
          expanded={expanded}
          customEmptyState={emptyStateContent}
          auditSession={auditSession}
          stats={stats}
          contextLabel={contextLabel}
          contextName={contextName}
        />
      )}
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
