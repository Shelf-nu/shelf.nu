import React from "react";
import type { Barcode, BookingStatus, Category, Kit } from "@prisma/client";
import { ChevronDownIcon } from "lucide-react";
import { LocationBadge } from "~/components/location/location-badge";
import { useBookingStatusHelpers } from "~/hooks/use-booking-status";
import { useCurrentOrganization } from "~/hooks/use-current-organization";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { resolveDisplayCode } from "~/modules/barcode/display";
import { hasAssetBookingConflicts } from "~/modules/booking/helpers";
import type { PartialCheckinDetailsType } from "~/modules/booking/service.server";
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
}: KitRowProps) {
  const { isBase } = useUserRoleHelper();
  const { isDraft, isReserved, isInProgress, isFinished } =
    useBookingStatusHelpers(bookingStatus);
  // Workspace pref + addon entitlement — resolver short-circuits to QR when
  // the org has lost the barcode add-on, so this read is always safe.
  const currentOrganization = useCurrentOrganization();
  // Kits don't have sequentialId / preferredBarcodeId in v1; the resolver's
  // optional fields tolerate that and fall back to QR when workspace pref
  // is SAM.
  const displayCode = currentOrganization
    ? resolveDisplayCode({ entity: kit, organization: currentOrganization })
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

  // Kit is overlapping if it's not AVAILABLE and has conflicting bookings
  // Use centralized booking conflict logic
  const isOverlapping =
    kit.status !== "AVAILABLE" &&
    assets.some((asset) => hasAssetBookingConflicts(asset, bookingId));

  return (
    <React.Fragment>
      <ListItem item={kit} className="relative bg-gray-50">
        <BulkListItemCheckbox item={kit} bulkItems={assets} />

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
                {isFinished ? (
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

        <Td>
          <When truthy={isOverlapping && !isInProgress}>
            <AvailabilityBadge
              badgeText="Already booked"
              tooltipTitle="Kit is already booked"
              tooltipContent="This kit is already added to a booking that is overlapping the selected time period."
            />
          </When>
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
            />
          </ListItem>
        ))}
      </When>

      {/* Add a separator row after the kit assets */}
      <tr className="kit-separator h-1 bg-gray-100">
        <td colSpan={shouldShowCheckinColumns ? 9 : 7} className="h-1 p-0"></td>
      </tr>
    </React.Fragment>
  );
}
