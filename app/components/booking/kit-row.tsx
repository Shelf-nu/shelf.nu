import React from "react";
import type { BookingStatus, Category, Kit } from "@prisma/client";
import { ChevronDownIcon } from "lucide-react";
import { useBookingStatusHelpers } from "~/hooks/use-booking-status";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { hasAssetBookingConflicts } from "~/modules/booking/helpers";
import type { PartialCheckinDetailsType } from "~/modules/booking/service.server";
import type { AssetWithBooking } from "~/routes/_layout+/bookings.$bookingId.manage-assets";
import { getBookingContextKitStatus } from "~/utils/booking-assets";
import { tw } from "~/utils/tw";
import KitImage from "../kits/kit-image";
import { ListItem } from "../list/list-item";
import { Button } from "../shared/button";
import { Td } from "../table";
import { AvailabilityBadge } from "./availability-label";
import KitRowActionsDropdown from "./kit-row-actions-dropdown";
import ListAssetContent from "./list-asset-content";
import { CategoryBadge } from "../assets/category-badge";
import { KitStatusBadge } from "../kits/kit-status-badge";
import BulkListItemCheckbox from "../list/bulk-actions/bulk-list-item-checkbox";
import When from "../when/when";

type KitRowProps = {
  kit: Pick<Kit, "id" | "name" | "image" | "status"> & {
    imageExpiration: string | Date | null;
    category: Pick<Category, "name" | "id" | "color"> | null;
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
  const { isDraft, isReserved, isInProgress } =
    useBookingStatusHelpers(bookingStatus);

  // Create booking asset IDs set for context-aware status calculation
  const bookingAssetIds = new Set(assets.map((asset) => asset.id));

  // Get context-aware kit status using centralized helper
  const contextAwareKitStatus = getBookingContextKitStatus(
    { ...kit, assets: assets },
    partialCheckinDetails,
    bookingAssetIds
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

        <Td className={tw("w-full whitespace-normal p-0 md:p-0")}>
          <div className="flex items-center gap-3 py-4 md:justify-normal md:pr-6">
            <KitImage
              kit={{
                image: kit.image,
                imageExpiration: kit.imageExpiration,
                alt: kit.name,
                kitId: kit.id,
              }}
              className="size-12 rounded-[4px] border object-cover"
            />
            <div>
              <Button
                to={`/kits/${kit.id}`}
                variant="link"
                className="text-gray-900 hover:text-gray-700"
                target={"_blank"}
                onlyNewTabIconOnHover={true}
                aria-label="Go to kit"
              >
                <div className="max-w-[200px] truncate sm:max-w-[250px] md:max-w-[350px] lg:max-w-[450px]">
                  {kit.name}
                </div>
              </Button>
              <KitStatusBadge
                status={contextAwareKitStatus}
                availableToBook={true}
              />
            </div>
            <div className="ml-auto text-sm text-gray-600">
              {assets.length} assets
            </div>
          </div>
        </Td>

        <When truthy={isOverlapping && !isInProgress} fallback={<Td> </Td>}>
          <Td>
            <AvailabilityBadge
              badgeText="Already booked"
              tooltipTitle="Kit is already booked"
              tooltipContent="This kit is already added to a booking that is overlapping the selected time period."
            />
          </Td>
        </When>

        <Td>
          <CategoryBadge category={kit.category} />
        </Td>
        {shouldShowCheckinColumns && (
          <>
            {/* Checked in on - for kits we don't show specific dates */}
            <Td>
              <span className="text-sm text-gray-400">-</span>
            </Td>

            {/* Checked in by - for kits we don't show specific users */}
            <Td>
              <span className="text-sm text-gray-400">-</span>
            </Td>
          </>
        )}

        <Td className="pr-4 text-right align-middle">
          <div className="flex items-center justify-end gap-5">
            <Button
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
        <td colSpan={shouldShowCheckinColumns ? 7 : 5} className="h-1 p-0"></td>
      </tr>
    </React.Fragment>
  );
}
