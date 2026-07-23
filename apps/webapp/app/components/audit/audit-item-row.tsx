/**
 * Audit Drawer Row Components
 *
 * Presentational building blocks for the rows rendered inside the audit
 * scan drawer's item list. Extracted from `audit-drawer.tsx` to keep the
 * `AuditDrawer` component focused on state/data-flow orchestration while the
 * per-row markup lives here.
 *
 * Two row variants exist:
 * - {@link AuditItemRow} — a scanned item (found or unexpected), fetched and
 *   rendered through {@link GenericItemRow}.
 * - {@link AuditPendingRow} — an expected-but-not-yet-scanned asset.
 *
 * {@link renderAuditItems} composes both into the fragment consumed by
 * `ConfigurableDrawer`'s `customRenderAllItems` prop. It intentionally returns
 * a React fragment (not a wrapper component) so the keyed rows remain the
 * direct children handed to framer-motion's `<AnimatePresence>`, preserving the
 * exact presence-tracking behaviour of the original inline renderer.
 *
 * All components are defined at module scope so their identity is stable across
 * renders of `AuditDrawer` — a wrapper defined inside the parent's render would
 * remount the whole subtree every render (see the `react-render-stability`
 * repo rule).
 *
 * @see {@link file://./audit-drawer.tsx} — the consumer that orchestrates state.
 * @see {@link file://../scanner/drawer/generic-item-row.tsx} — the fetch/row primitive.
 */

import { type ReactNode } from "react";
import {
  type AuditAssetMeta,
  type AuditScannedItem,
  type AuditSessionInfo,
  type ScanListItem,
  type ScanListItems,
} from "~/atoms/qr-scanner";
import { AuditAssetActions } from "~/components/audit/audit-asset-actions";
import { AvailabilityBadge } from "~/components/booking/availability-label";
import ImageWithPreview from "~/components/image-with-preview/image-with-preview";
import { createAvailabilityLabels } from "~/components/scanner/drawer/availability-label-factory";
import {
  DefaultLoadingState,
  GenericItemRow,
  Tr,
} from "~/components/scanner/drawer/generic-item-row";
import { Button } from "~/components/shared/button";
import { tw } from "~/utils/tw";

/**
 * Shared styling for the "asset"/"kit" type chip rendered on every audit row.
 * Kept at module scope so the class-string identity stays stable across renders.
 */
const assetTypeBadgeClass = tw(
  "inline-block bg-gray-50 px-[6px] py-[2px]",
  "rounded-md border border-gray-200",
  "text-xs text-gray-700"
);

/** Props for {@link AuditItemRow}. */
type AuditItemRowProps = {
  /** The scanned QR/barcode id used as the fetch key and remove target. */
  qrId: string;
  /** The scanned-item entry (may still be loading) for this `qrId`. */
  item: ScanListItem;
  /** Removes the scanned item from the list; wired to the drawer's handler. */
  onRemove: (qrId: string) => void;
  /**
   * The `qrId` currently highlighted after a duplicate scan, or `null`.
   * When it matches this row's `qrId` the row gets a temporary amber tint.
   */
  highlightedQrId: string | null;
  /** The active audit session, or `null` when none is in progress. */
  auditSession: AuditSessionInfo;
  /** Ids of assets expected in this audit — drives the Expected/Unexpected badge. */
  expectedAssetIds: Set<string>;
  /** Live, client-side note/image count overrides keyed by `auditAssetId`. */
  auditAssetMeta: Record<string, AuditAssetMeta>;
  /** Whether to show the asset's location (hidden when the audit is location-scoped). */
  showLocation: boolean;
};

/**
 * Renders a single scanned audit row via {@link GenericItemRow}, which handles
 * the async fetch/loading/error lifecycle. The inner render prop produces the
 * resolved-asset markup: image, (conditionally linked) title, location, the
 * type chip, an Expected/Unexpected availability badge, and the note/image
 * action buttons.
 *
 * @param props - See {@link AuditItemRowProps}.
 * @returns The scanned-item table row.
 */
export function AuditItemRow({
  qrId,
  item,
  onRemove,
  highlightedQrId,
  auditSession,
  expectedAssetIds,
  auditAssetMeta,
  showLocation,
}: AuditItemRowProps) {
  const itemType = item?.type;

  return (
    <GenericItemRow
      qrId={qrId}
      item={item}
      onRemove={onRemove}
      className={
        highlightedQrId === qrId
          ? "duration-[2500ms] bg-amber-50 transition-colors"
          : undefined
      }
      searchParams={
        auditSession ? { auditSessionId: auditSession.id } : undefined
      }
      // Audits are asset-only: kits have no `AuditAsset` record, so a
      // scanned kit is rejected here (becomes an error row) instead of
      // entering the normal scanned-asset pipeline — no detail link, no
      // persistence attempt. See `use-audit-scan-persistence.ts` for the
      // matching defensive skip.
      rejectItemType="kit"
      rejectItemMessage="Audits track assets, not kits — scan the kit's individual assets."
      renderLoading={(pendingQrId: string, error?: string) => (
        <DefaultLoadingState qrId={pendingQrId} error={error} />
      )}
      renderItem={(data: any) => {
        const isAsset = itemType === "asset";
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
              {/* Only navigate to the details view when we actually have an
                  AuditAsset id — rendering `to={`${undefined}/details`}` would
                  produce a broken `/scan/undefined/details` link (404). */}
              {auditAssetId ? (
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
              ) : (
                <span className="word-break whitespace-break-spaces text-left font-medium text-gray-800">
                  {"title" in data ? data.title : data.name}
                </span>
              )}
              {showLocation && data.location?.name && (
                <span className="text-xs text-gray-500">
                  {data.location.name}
                </span>
              )}
              <div className="flex flex-wrap items-center gap-1">
                <span className={assetTypeBadgeClass}>
                  {itemType === "asset" ? "asset" : "kit"}
                </span>
                <AuditLabels />
                {/* Action buttons for notes and images */}
                {auditSession && itemType === "asset" && data?.id && (
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
}

/** Props for {@link AuditPendingRow}. */
type AuditPendingRowProps = {
  /** The expected-but-not-yet-scanned asset to render. */
  asset: AuditScannedItem;
  /** The active audit session, or `null` when none is in progress. */
  auditSession: AuditSessionInfo;
  /** Live, client-side note/image count overrides keyed by `auditAssetId`. */
  auditAssetMeta: Record<string, AuditAssetMeta>;
  /** Whether to show the asset's location (hidden when the audit is location-scoped). */
  showLocation: boolean;
};

/**
 * Renders a pending (expected but not yet scanned) audit asset. Unlike
 * {@link AuditItemRow} there is no async fetch and no remove button — the row
 * shows the asset with a "Pending" badge and the note/image action buttons.
 *
 * @param props - See {@link AuditPendingRowProps}.
 * @returns The pending-asset table row.
 */
export function AuditPendingRow({
  asset,
  auditSession,
  auditAssetMeta,
  showLocation,
}: AuditPendingRowProps) {
  return (
    <Tr skipEntrance>
      <td className="w-full p-0 md:p-0">
        <div className="flex items-center justify-between gap-3 p-4 md:px-6">
          <div className="flex items-center gap-2">
            <ImageWithPreview
              thumbnailUrl={asset.thumbnailImage || asset.mainImage}
              alt={asset.name || "Asset"}
              className="size-[54px] rounded-[2px]"
            />

            <div className="flex flex-col gap-1">
              {/* Same defensive guard as the scanned-item row above — never
                  link to `/details` without a real AuditAsset id. */}
              {asset.auditAssetId ? (
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
              ) : (
                <span className="word-break whitespace-break-spaces text-left font-medium text-gray-800">
                  {asset.name}
                </span>
              )}
              {showLocation && asset.locationName && (
                <span className="text-xs text-gray-500">
                  {asset.locationName}
                </span>
              )}
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
}

/** Arguments for {@link renderAuditItems}. */
type RenderAuditItemsArgs = {
  /** All scanned items keyed by `qrId`. */
  items: ScanListItems;
  /** Assets expected in this audit (used to derive the pending list). */
  expectedAssets: AuditScannedItem[];
  /** Ids of assets that have already been scanned, for quick lookup. */
  scannedAssetIds: Set<string>;
  /** Removes a scanned item from the list. */
  onRemove: (qrId: string) => void;
  /** The `qrId` currently highlighted after a duplicate scan, or `null`. */
  highlightedQrId: string | null;
  /** The active audit session, or `null` when none is in progress. */
  auditSession: AuditSessionInfo;
  /** Ids of assets expected in this audit. */
  expectedAssetIds: Set<string>;
  /** Live, client-side note/image count overrides keyed by `auditAssetId`. */
  auditAssetMeta: Record<string, AuditAssetMeta>;
  /** Whether to show each asset's location. */
  showLocation: boolean;
};

/**
 * Renders the full audit item list: scanned rows first (in scan order),
 * followed by the pending (expected but not scanned) assets.
 *
 * Returns a React fragment rather than a wrapper component so the keyed rows
 * stay the direct children passed to `<AnimatePresence>`, preserving the
 * drawer's original presence-tracking behaviour exactly.
 *
 * @param args - See {@link RenderAuditItemsArgs}.
 * @returns The scanned and pending rows as a fragment.
 */
export function renderAuditItems({
  items,
  expectedAssets,
  scannedAssetIds,
  onRemove,
  highlightedQrId,
  auditSession,
  expectedAssetIds,
  auditAssetMeta,
  showLocation,
}: RenderAuditItemsArgs): ReactNode {
  // Pending = expected assets that have not been scanned yet.
  const pendingAssets = expectedAssets.filter(
    (asset) => !scannedAssetIds.has(asset.id)
  );

  // Render scanned items first, then pending assets at the bottom.
  return (
    <>
      {Object.entries(items).map(([qrId, item]) => (
        <AuditItemRow
          key={qrId}
          qrId={qrId}
          item={item}
          onRemove={onRemove}
          highlightedQrId={highlightedQrId}
          auditSession={auditSession}
          expectedAssetIds={expectedAssetIds}
          auditAssetMeta={auditAssetMeta}
          showLocation={showLocation}
        />
      ))}
      {pendingAssets.map((asset) => (
        <AuditPendingRow
          key={`pending-${asset.id}`}
          asset={asset}
          auditSession={auditSession}
          auditAssetMeta={auditAssetMeta}
          showLocation={showLocation}
        />
      ))}
    </>
  );
}
