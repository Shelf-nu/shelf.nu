import { useMemo } from "react";
import type { useLoaderData } from "react-router";
import { useCurrentOrganization } from "~/hooks/use-current-organization";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import type { AdvancedAssetBooking } from "~/modules/asset/types";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";
import { getStatusClasses, isOneDayEvent } from "~/utils/calendar";
import { useHints } from "~/utils/client-hints";
import { toIsoDateTimeToUserTimezone } from "~/utils/date-fns";
import type { OrganizationPermissionSettings } from "~/utils/permissions/custody-and-bookings-permissions.validator.client";
import { userHasCustodyViewPermission } from "~/utils/permissions/custody-and-bookings-permissions.validator.client";

type Items = NonNullable<
  ReturnType<typeof useLoaderData<AssetIndexLoaderData>>["items"]
>;

export function useAssetAvailabilityData(items: Items) {
  const { roles } = useUserRoleHelper();
  const organization = useCurrentOrganization();
  const canSeeAllCustody = userHasCustodyViewPermission({
    roles,
    organization: organization as OrganizationPermissionSettings,
  });

  const { timeZone } = useHints();

  const { resources, events } = useMemo(() => {
    const resources = items.map((item) => ({
      id: item.id,
      title: item.title,
      extendedProps: {
        mainImage: item.mainImage,
        thumbnailImage: item.thumbnailImage,
        mainImageExpiration: item.mainImageExpiration,
        status: item.status,
        availableToBook: item.availableToBook,
        category: item.category,
      },
    }));

    const events = items
      .map((asset) => {
        if (!asset.bookings) {
          return [];
        }

        return [
          ...asset.bookings.map((b) => {
            const booking = b as AdvancedAssetBooking;
            const custodianName = booking?.custodianUser
              ? `${booking.custodianUser.firstName} ${booking.custodianUser.lastName}`
              : booking.custodianTeamMember?.name;

            let title = booking.name;
            if (canSeeAllCustody) {
              title += ` | ${custodianName}`;
            }

            return {
              title,
              resourceId: asset.id,
              url: `/bookings/${booking.id}`,
              start: toIsoDateTimeToUserTimezone(booking.from!, timeZone),
              end: toIsoDateTimeToUserTimezone(booking.to!, timeZone),
              classNames: [
                `bookingId-${booking.id}`,
                ...getStatusClasses(
                  booking.status,
                  isOneDayEvent(new Date(booking.from), new Date(booking.to)),
                  "px-1"
                ),
              ],
              extendedProps: {
                id: booking.id,
                name: booking.name,
                status: booking.status,
                title: booking.name,
                description: booking.description,
                start: booking.from,
                end: booking.to,
                custodian: {
                  name: custodianName,
                  user: booking.custodianUser
                    ? {
                        id: booking.custodianUser?.id,
                        firstName: booking.custodianUser?.firstName,
                        lastName: booking.custodianUser?.lastName,
                        profilePicture: booking.custodianUser?.profilePicture,
                      }
                    : undefined,
                },
                creator: booking.creator
                  ? {
                      name: booking.creator
                        ? `${booking.creator.firstName} ${booking.creator.lastName}`.trim()
                        : "Unknown",
                      user: booking.creator
                        ? {
                            id: booking.creator.id,
                            firstName: booking.creator.firstName,
                            lastName: booking.creator.lastName,
                            profilePicture: booking.creator.profilePicture,
                          }
                        : null,
                    }
                  : undefined,
                tags: booking.tags,
              },
            };
          }),
        ];
      })
      .flat();

    return { resources, events };
  }, [canSeeAllCustody, items, timeZone]);

  return {
    resources,
    events,
  };
}
