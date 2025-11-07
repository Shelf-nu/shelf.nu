import { useMemo } from "react";
import type { Booking, TeamMember, User } from "@prisma/client";
import type { useLoaderData } from "@remix-run/react";
import { useCurrentOrganization } from "~/hooks/use-current-organization";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import type { KitIndexLoaderData } from "~/routes/_layout+/kits._index";
import { getStatusClasses, isOneDayEvent } from "~/utils/calendar";
import { useHints } from "~/utils/client-hints";
import { toIsoDateTimeToUserTimezone } from "~/utils/date-fns";
import type { OrganizationPermissionSettings } from "~/utils/permissions/custody-and-bookings-permissions.validator.client";
import { userHasCustodyViewPermission } from "~/utils/permissions/custody-and-bookings-permissions.validator.client";

type Items = NonNullable<
  ReturnType<typeof useLoaderData<KitIndexLoaderData>>["items"]
>;

export function useKitAvailabilityData(items: Items) {
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
      title: item.name,
      extendedProps: {
        mainImage: item.image,
        thumbnailImage: item.imageExpiration,
        status: item.status,
        availableToBook: item.assets.some((asset) => asset.availableToBook),
      },
    }));

    // Collect all unique bookings across all kits and their assets
    const allBookings = new Map();

    items.forEach((kit) => {
      kit.assets.forEach((asset) => {
        if (asset.bookings) {
          asset.bookings.forEach((booking) => {
            // Use booking ID as key to ensure uniqueness
            if (!allBookings.has(booking.id)) {
              allBookings.set(booking.id, { ...booking, kitId: kit.id });
            }
          });
        }
      });
    });

    const events = Array.from(allBookings.values()).map((booking) => {
      const bookingWithRelations = booking as Booking & {
        custodianUser?: User;
        custodianTeamMember?: TeamMember;
        kitId: string;
      };

      const custodianName = bookingWithRelations?.custodianUser
        ? `${bookingWithRelations.custodianUser.firstName} ${bookingWithRelations.custodianUser.lastName}`
        : bookingWithRelations.custodianTeamMember?.name;

      let title = bookingWithRelations.name;
      if (canSeeAllCustody) {
        title += ` | ${custodianName}`;
      }

      return {
        title,
        resourceId: bookingWithRelations.kitId,
        url: `/bookings/${bookingWithRelations.id}`,
        start: toIsoDateTimeToUserTimezone(
          bookingWithRelations.from!,
          timeZone
        ),
        end: toIsoDateTimeToUserTimezone(bookingWithRelations.to!, timeZone),
        classNames: [
          `bookingId-${bookingWithRelations.id}`,
          ...getStatusClasses(
            bookingWithRelations.status,
            isOneDayEvent(
              bookingWithRelations.from as Date,
              bookingWithRelations.to as Date
            ),
            "px-1"
          ),
        ],
        extendedProps: {
          id: bookingWithRelations.id,
          name: bookingWithRelations.name,
          status: bookingWithRelations.status,
          title: bookingWithRelations.name,
          description: bookingWithRelations.description,
          start: bookingWithRelations.from,
          end: bookingWithRelations.to,
          custodian: {
            name: custodianName,
            user: bookingWithRelations.custodianUser
              ? {
                  id: bookingWithRelations.custodianUserId,
                  firstName: bookingWithRelations.custodianUser?.firstName,
                  lastName: bookingWithRelations.custodianUser?.lastName,
                  profilePicture:
                    bookingWithRelations.custodianUser?.profilePicture,
                }
              : undefined,
          },
        },
      };
    });

    return { resources, events };
  }, [canSeeAllCustody, items, timeZone]);

  return {
    resources,
    events,
  };
}
