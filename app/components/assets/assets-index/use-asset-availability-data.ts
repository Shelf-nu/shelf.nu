import { useMemo } from "react";
import type { Booking, TeamMember, User } from "@prisma/client";
import { useLoaderData } from "@remix-run/react";
import { useCurrentOrganization } from "~/hooks/use-current-organization";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";
import { getStatusClasses, isOneDayEvent } from "~/utils/calendar";
import type { OrganizationPermissionSettings } from "~/utils/permissions/custody-and-bookings-permissions.validator.client";
import { userHasCustodyViewPermission } from "~/utils/permissions/custody-and-bookings-permissions.validator.client";

export function useAssetAvailabilityData() {
  const { items } = useLoaderData<AssetIndexLoaderData>();
  const { roles } = useUserRoleHelper();
  const organization = useCurrentOrganization();
  const canSeeAllCustody = userHasCustodyViewPermission({
    roles,
    organization: organization as OrganizationPermissionSettings,
  });

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
      },
    }));

    const events = items
      .map((asset) => {
        if (!asset.bookings) {
          return [];
        }

        return [
          ...asset.bookings.map((b) => {
            const booking = b as Booking & {
              custodianUser?: User;
              custodianTeamMember?: TeamMember;
            };

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
              start: booking.from!,
              end: booking.to!,
              classNames: [
                `bookingId-${booking.id}`,
                ...getStatusClasses(
                  booking.status,
                  isOneDayEvent(booking.from as Date, booking.to as Date),
                  "px-1"
                ),
              ],
              extendedProps: {
                id: b.id,
                name: b.name,
                status: b.status,
                title: b.name,
                description: b.description,
                start: b.from,
                end: b.to,
                custodian: {
                  name: custodianName,
                  user: booking.custodianUser
                    ? {
                        id: booking.custodianUserId,
                        firstName: booking.custodianUser?.firstName,
                        lastName: booking.custodianUser?.lastName,
                        profilePicture: booking.custodianUser?.profilePicture,
                      }
                    : undefined,
                },
              },
            };
          }),
        ];
      })
      .flat();

    return { resources, events };
  }, [canSeeAllCustody, items]);

  return {
    resources,
    events,
  };
}
