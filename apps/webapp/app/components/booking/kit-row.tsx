/**
 * Kit Row
 *
 * One kit in a booking's asset table. The header shows the kit's image and
 * name, its booking-aware status (or a Returned badge), its code chip, the
 * "Already booked" overlap signal and the number of member rows; when expanded,
 * each booked member asset renders beneath it through `ListAssetContent`.
 *
 * "Already booked" comes from the member assets' bookings and this kit's own
 * booking slices, never from `Kit.status`: a kit that an overlapping booking has
 * only reserved is still AVAILABLE.
 *
 * @see {@link file://./booking-assets-column.tsx} renders one KitRow per kit
 * @see {@link file://./list-asset-content.tsx} the member asset rows
 */
import React from "react";
import type { Barcode, BookingStatus, Category, Kit } from "@prisma/client";
import { ChevronDownIcon } from "lucide-react";
import { LocationBadge } from "~/components/location/location-badge";
import { useBookingBulkActions } from "~/hooks/use-booking-bulk-actions";
import { useBookingStatusHelpers } from "~/hooks/use-booking-status";
import { useCurrentOrganization } from "~/hooks/use-current-organization";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { resolveDisplayCode } from "~/modules/barcode/display";
import {
  hasAssetBookingConflicts,
  hasKitBookingConflicts,
} from "~/modules/booking/helpers";
import type { KitBookingSlice } from "~/modules/booking/helpers";
import type {
  PartialCheckinDetailsType,
  PartialCheckoutDetailsType,
} from "~/modules/booking/service.server";
import type { AssetWithBooking } from "~/routes/_layout+/bookings.$bookingId.overview.manage-assets";
import { getBookingContextKitStatus } from "~/utils/booking-assets";
import { tw } from "~/utils/tw";
import { AvailabilityBadge } from "./availability-label";
import KitRowActionsDropdown from "./kit-row-actions-dropdown";
import ListAssetContent from "./list-asset-content";
import { AssetCodeBadge } from "../assets/asset-code-badge";
import { CategoryBadge } from "../assets/category-badge";
import KitImage from "../kits/kit-image";
import { KitStatusBadge } from "../kits/kit-status-badge";
import BulkListItemCheckbox from "../list/bulk-actions/bulk-list-item-checkbox";
import { ListItem } from "../list/list-item";
import { Button } from "../shared/button";
import { EmptyTableValue } from "../shared/empty-table-value";
import { ReturnedBadge } from "../shared/returned-badge";
import { Td } from "../table";
import When from "../when/when";

type KitRowProps = {
  kit: Pick<Kit, "id" | "name" | "image" | "status"> & {
    imageExpiration: string | Date | null;
    category: Pick<Category, "name" | "id" | "color"> | null;
    // Kit's pickup location — rendered in the Location column.
    location?: {
      id: string;
      name: string;
      parentId: string | null;
      _count?: { children: number };
    } | null;
    // Code-resolution relations — needed so the chip resolves on the kit row.
    // Kits don't have sequentialId / preferredBarcodeId in v1; the resolver's
    // optional fields tolerate that and fall back to QR when workspace pref
    // is SAM.
    qrCodes?: { id: string }[];
    barcodes?: Pick<Barcode, "id" | "type" | "value">[];
  };
  isExpanded: boolean;
  bookingStatus: BookingStatus;
  bookingId: string;
  assets: AssetWithBooking[];
  onToggleExpansion?: (kitId: string) => void;
  partialCheckinDetails: PartialCheckinDetailsType;
  shouldShowCheckinColumns: boolean;
  /** Per-asset partial check-OUT details (date + user) keyed by asset id. */
  partialCheckoutDetails: PartialCheckoutDetailsType;
  /** Whether the "Checked out on/by" columns should render. */
  shouldShowCheckoutColumns: boolean;
};

export default function KitRow({
  kit,
  isExpanded,
  bookingStatus,
  onToggleExpansion,
  assets,
  bookingId,
  partialCheckinDetails,
  shouldShowCheckinColumns,
  partialCheckoutDetails,
  shouldShowCheckoutColumns,
}: KitRowProps) {
  const { isBase } = useUserRoleHelper();
  const { hasAny: hasAnyBulkAction } = useBookingBulkActions();
  const { isDraft, isReserved, isInProgress, isFinished } =
    useBookingStatusHelpers(bookingStatus);
  // Workspace pref + addon entitlement — resolver short-circuits to QR when
  // the org has lost the barcode add-on, so this read is always safe.
  const currentOrganization = useCurrentOrganization();
  // Kits don't have sequentialId / preferredBarcodeId in v1; the resolver's
  // optional fields tolerate that and fall back to QR when workspace pref
  // is SAM.
  const displayCode = currentOrganization
    ? resolveDisplayCode({
        entity: kit,
        organization: currentOrganization,
        entityKind: "kit",
      })
    : null;

  // Create booking asset IDs set for context-aware status calculation
  const bookingAssetIds = new Set(assets.map((asset) => asset.id));

  // Get context-aware kit status using centralized helper
  const contextAwareKitStatus = getBookingContextKitStatus(
    { ...kit, assets: assets },
    partialCheckinDetails,
    bookingAssetIds,
    bookingStatus
  );

  /**
   * Kit-driven slices of THIS kit across its member assets. A slice belongs to
   * this kit when it is live (`assetKitId` set) and either its `sourceKitId`
   * names the kit or its `assetKitId` is one of the asset's own memberships of
   * the kit — the second covers rows written without `sourceKitId`. Never a
   * standalone row of the same asset, or a slice held through another kit.
   */
  const thisKitSlices: KitBookingSlice[] = assets.flatMap((asset) => {
    const membershipIdsOfThisKit = new Set(
      (asset.assetKits ?? [])
        .filter((membership) => membership.kitId === kit.id)
        .map((membership) => membership.id)
    );
    return (asset.bookingAssets ?? []).filter(
      (ba) =>
        ba.assetKitId !== null &&
        (ba.sourceKitId === kit.id || membershipIdsOfThisKit.has(ba.assetKitId))
    );
  });

  // "Already booked" comes from the bookings and their slices, never from
  // `Kit.status`: a kit another booking has only reserved is still AVAILABLE.
  // `hasAssetBookingConflicts` exempts QUANTITY_TRACKED members, since several
  // bookings may share a pool, so `hasKitBookingConflicts` is ORed in to catch a
  // conflict recorded on the kit's own slices.
  const isOverlapping =
    assets.some((asset) => hasAssetBookingConflicts(asset, bookingId)) ||
    hasKitBookingConflicts(thisKitSlices, bookingId);

  // A kit "returned" as a unit only when EVERY one of its assets was actually
  // checked out — the same unanimity rule the lifecycle bar uses in unit mode
  // (a kit split across buckets counts as Booked). When the booking used
  // progressive checkout, partialCheckoutDetails identifies the checked-out
  // assets; when it has no checkout records (quick/all-at-once checkout), every
  // asset was checked out.
  const hasProgressiveCheckout = Object.keys(partialCheckoutDetails).length > 0;
  const kitWasCheckedOut = hasProgressiveCheckout
    ? assets.every((a) => Boolean(partialCheckoutDetails[a.id]))
    : true;

  return (
    <React.Fragment>
      <ListItem item={kit} className="relative bg-gray-50">
        {/* Same gate the asset rows use, and the empty cell keeps the column
            aligned with them. A checkbox is only offered when this user has a
            bulk action to feed: selecting rows for a menu that renders nothing
            is dead UI. */}
        <When truthy={hasAnyBulkAction} fallback={<Td> </Td>}>
          <BulkListItemCheckbox item={kit} bulkItems={assets} />
        </When>

        <Td
          className={tw(
            "w-full min-w-[300px] max-w-[400px] whitespace-normal p-0 md:p-0"
          )}
        >
          <div className="flex items-center gap-3 py-4 md:justify-normal md:pr-6">
            <KitImage
              kit={{
                image: kit.image,
                imageExpiration: kit.imageExpiration,
                alt: kit.name,
                kitId: kit.id,
              }}
              className="size-12 shrink-0 rounded-[4px] border object-cover"
            />
            <div className="">
              <Button
                to={`/kits/${kit.id}`}
                variant="link"
                className="font-medium text-gray-900 hover:text-gray-700"
                target={"_blank"}
                onlyNewTabIconOnHover={true}
                aria-label="Go to kit"
              >
                <div className="">{kit.name}</div>
              </Button>
              {/*
                Same metadata-line composition as other code-bearing surfaces:
                status first, code chip second. flex-wrap handles narrow viewports.
              */}
              <div className="flex flex-wrap items-center gap-2">
                {isFinished && kitWasCheckedOut ? (
                  <ReturnedBadge />
                ) : (
                  <KitStatusBadge
                    status={contextAwareKitStatus}
                    availableToBook={true}
                  />
                )}
                {displayCode ? <AssetCodeBadge {...displayCode} /> : null}
              </div>
            </div>
          </div>
        </Td>

        {/* Qty — empty for kit header rows */}
        <Td> </Td>

        {/*
          why: out of this rule — kit header has no status badge.
          Per the code-bearing-entity-list-consistency rule, the
          per-row InsufficientStockBadge fires inside ListAssetContent
          for each expanded QT asset child (kit-row delegates to it
          via the loop below). The kit header itself only surfaces the
          "Already booked" overlap signal and an asset count; it has
          no aggregate stock or per-unit booking semantics of its own,
          so no insufficient-stock badge belongs here.
        */}
        <Td>
          <When truthy={isOverlapping && !isInProgress}>
            <AvailabilityBadge
              badgeText="Already booked"
              tooltipTitle="Kit is already booked"
              tooltipContent="This kit is already added to a booking that is overlapping the selected time period."
            />
          </When>
          {/*
            Deliberately the count of RENDERED slices, never the kit's
            `_count.assetKits`. The latter is CURRENT membership, so a kit
            whose members have since been removed (its booking slices survive
            via `BookingAsset.sourceKitId`) would print a count that
            contradicts the rows listed directly beneath it.
          */}
          <div className="text-sm text-gray-600">{assets.length} assets</div>
        </Td>

        <Td>
          <CategoryBadge category={kit.category} />
        </Td>
        <Td>
          <EmptyTableValue />
        </Td>
        <Td>
          {kit.location ? (
            <LocationBadge
              location={{
                id: kit.location.id,
                name: kit.location.name,
                parentId: kit.location.parentId ?? undefined,
                childCount: kit.location._count?.children ?? 0,
              }}
            />
          ) : (
            <EmptyTableValue />
          )}
        </Td>
        {shouldShowCheckoutColumns && (
          <>
            {/*
              why: kit-header partial-checkout rollup deferred — per-asset rows
              already surface it via ListAssetContent (badge + Qty progress).
              Aggregating across mixed-state kit children at the header level
              would require a unanimity rule similar to kitWasCheckedOut above
              and is intentionally out of scope here.
            */}
            {/* Checked out on - for kits we don't show specific dates */}
            <Td>
              <EmptyTableValue />
            </Td>

            {/* Checked out by - for kits we don't show specific users */}
            <Td>
              <EmptyTableValue />
            </Td>
          </>
        )}
        {shouldShowCheckinColumns && (
          <>
            {/* Checked in on - for kits we don't show specific dates */}
            <Td>
              <EmptyTableValue />
            </Td>

            {/* Checked in by - for kits we don't show specific users */}
            <Td>
              <EmptyTableValue />
            </Td>
          </>
        )}

        <Td className="pr-4 text-right align-middle">
          <div className="flex items-center justify-end gap-5">
            <Button
              type="button"
              onClick={() => {
                onToggleExpansion && onToggleExpansion(kit.id);
              }}
              variant="link"
              className="text-center font-bold text-gray-600 hover:text-gray-900"
              aria-label="Toggle kit expand"
            >
              <ChevronDownIcon
                className={tw(`size-6 ${!isExpanded ? "rotate-180" : ""}`)}
              />
            </Button>
            {(!isBase && isDraft) || isReserved ? (
              <KitRowActionsDropdown kit={kit} />
            ) : null}
          </div>
        </Td>
      </ListItem>

      <When truthy={isExpanded}>
        {assets.map((asset) => (
          <ListItem
            key={`kit-asset-${asset.id}`}
            item={asset}
            className="relative"
            motionProps={{
              initial: { opacity: 0, y: -10 },
              animate: { opacity: 1, y: 0 },
              exit: { opacity: 0, y: 10 },
              transition: {
                duration: 0.3,
                ease: "easeInOut",
              },
            }}
          >
            <ListAssetContent
              item={asset}
              isKitAsset
              partialCheckinDetails={partialCheckinDetails}
              shouldShowCheckinColumns={shouldShowCheckinColumns}
              partialCheckoutDetails={partialCheckoutDetails}
              shouldShowCheckoutColumns={shouldShowCheckoutColumns}
            />
          </ListItem>
        ))}
      </When>

      {/* Add a separator row after the kit assets */}
      <tr className="kit-separator h-1 bg-gray-100">
        <td
          colSpan={
            7 +
            (shouldShowCheckinColumns ? 2 : 0) +
            (shouldShowCheckoutColumns ? 2 : 0)
          }
          className="h-1 p-0"
        ></td>
      </tr>
    </React.Fragment>
  );
}
