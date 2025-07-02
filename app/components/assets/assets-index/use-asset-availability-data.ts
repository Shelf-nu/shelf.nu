import { useMemo } from "react";
import type { Booking, Tag, TeamMember, User } from "@prisma/client";
import type { SerializeFrom } from "@remix-run/node";
import { useCurrentOrganization } from "~/hooks/use-current-organization";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";
import { getStatusClasses, isOneDayEvent } from "~/utils/calendar";
import { useHints } from "~/utils/client-hints";
import { toIsoDateTimeToUserTimezone } from "~/utils/date-fns";
import type { OrganizationPermissionSettings } from "~/utils/permissions/custody-and-bookings-permissions.validator.client";
import { userHasCustodyViewPermission } from "~/utils/permissions/custody-and-bookings-permissions.validator.client";

type LoaderData = SerializeFrom<AssetIndexLoaderData>;
type Items = NonNullable<LoaderData["items"]>;

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
        id: item.id,
        mainImage: item.mainImage,
        thumbnailImage: item.thumbnailImage,
        mainImageExpiration: item.mainImageExpiration,
        status: item.status,
        availableToBook: item.availableToBook,
        category: item.category,
        kit: item?.kit,
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
              tags: Pick<Tag, "id" | "name">[];
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
              url: `/bookings/${booking.id}`,
              start: toIsoDateTimeToUserTimezone(booking.from!, timeZone),
              end: toIsoDateTimeToUserTimezone(booking.to!, timeZone),
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
