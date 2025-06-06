import React from "react";
import type { BookingStatus, Kit } from "@prisma/client";
import { ChevronDownIcon } from "lucide-react";
import { useBookingStatusHelpers } from "~/hooks/use-booking-status";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import type { AssetWithBooking } from "~/routes/_layout+/bookings.$bookingId.add-assets";
import { tw } from "~/utils/tw";
import KitImage from "../kits/kit-image";
import { ListItem } from "../list/list-item";
import { Button } from "../shared/button";
import { Td } from "../table";
import { AvailabilityBadge } from "./availability-label";
import KitRowActionsDropdown from "./kit-row-actions-dropdown";
import ListAssetContent from "./list-asset-content";
import When from "../when/when";

type KitRowProps = {
  kit: Pick<Kit, "id" | "name" | "image"> & {
    imageExpiration: string | Date | null;
  };
  isExpanded: boolean;
  bookingStatus: BookingStatus;
  bookingId: string;
  assets: AssetWithBooking[];
  onToggleExpansion?: (kitId: string) => void;
};

export default function KitRow({
  kit,
  isExpanded,
  bookingStatus,
  onToggleExpansion,
  assets,
  bookingId,
}: KitRowProps) {
  const { isBase } = useUserRoleHelper();
  const { isDraft, isReserved } = useBookingStatusHelpers(bookingStatus);

  const isOverlapping = assets.some(
    (asset) =>
      asset.bookings?.length && asset.bookings.some((b) => b.id !== bookingId)
  );

  return (
    <React.Fragment>
      <ListItem item={kit} className="pseudo-border-bottom bg-gray-50">
        <Td className="max-w-full">
          <div className="flex items-center gap-3">
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
              <p className="text-sm text-gray-600">{assets.length} assets</p>
            </div>
          </div>
        </Td>
        <When truthy={isOverlapping} fallback={<Td> </Td>}>
          <Td>
            <AvailabilityBadge
              badgeText="Already booked"
              tooltipTitle="Kit is already booked"
              tooltipContent="This kit is already added to a booking that is overlapping the selected time period."
            />
          </Td>
        </When>

        <Td> </Td>

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
            <ListAssetContent item={asset} isKitAsset />
          </ListItem>
        ))}
      </When>

      {/* Add a separator row after the kit assets */}
      <tr className="kit-separator h-1 bg-gray-100">
        <td colSpan={4} className="h-1 p-0"></td>
      </tr>
    </React.Fragment>
  );
}
