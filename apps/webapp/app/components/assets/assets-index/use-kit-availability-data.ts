import { useMemo } from "react";
import type { Booking, TeamMember, User } from "@prisma/client";
import type { useLoaderData } from "react-router";
import { useCurrentOrganization } from "~/hooks/use-current-organization";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import type { KitIndexLoaderData } from "~/routes/_layout+/kits._index";
import { getStatusClasses, isOneDayEvent } from "~/utils/calendar";
import { useHints } from "~/utils/client-hints";
import { toIsoDateTimeToUserTimezone } from "~/utils/date-fns";
import type { OrganizationPermissionSettings } from "~/utils/permissions/custody-and-bookings-permissions.validator.client";
import { userHasCustodyViewPermission } from "~/utils/permissions/custody-and-bookings-permissions.validator.client";
import { resolveUserDisplayName } from "~/utils/user";

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
        // why: match the list view's semantic in kits._index.tsx — a kit is
        // bookable only when ALL slices are bookable (booking reserves the
        // whole kit). Undefined assetKits is treated as not-bookable since we
        // can't verify the slices.
        availableToBook:
          item.assetKits == null
            ? false
            : !item.assetKits.some((ak) => !ak.asset.availableToBook),
      },
    }));

    // Collect all unique booking-kit combinations across all kits
    // A booking can span multiple kits (via assets from different kits),
    // so we use a composite key to ensure each kit gets its own event
    const allBookings = new Map();

    items.forEach((kit) => {
      (kit.assetKits ?? []).forEach((ak) => {
        const asset = ak.asset;
        if ("bookingAssets" in asset && asset.bookingAssets) {
          // Cast through `unknown` because the kits._index loader passes
          // its `extraInclude` shape through a `<T extends Prisma.KitInclude>`
          // generic that doesn't propagate the deep
          // `bookingAssets.select.{assetKitId, booking}` selection back to
          // consumers — TS sees the default BookingAsset scalar shape
          // which doesn't overlap with the asserted projection. Runtime
          // shape is correct: loader at kits._index.tsx selects
          // assetKitId + booking.
          (
            asset.bookingAssets as unknown as Array<{
              assetKitId: string | null;
              booking: Booking;
            }>
          )
            // Per-kit-slice filter (Codex review #2676 P2): a QT asset
            // shared between Kit A and Kit B has one BookingAsset row per
            // kit slice, each tagged with its own assetKitId. Only emit
            // the slice belonging to THIS outer kit-iteration (ak.id),
            // so Kit B's calendar doesn't render bookings that actually
            // reserved Kit A's slice. Standalone slices (assetKitId =
            // null) are intentionally dropped — they're not kit-specific.
            .filter((ba) => ba.assetKitId === ak.id)
            .forEach((ba) => {
              const booking = ba.booking;
              const key = `${booking.id}-${kit.id}`;
              if (!allBookings.has(key)) {
                allBookings.set(key, { ...booking, kitId: kit.id });
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
        ? resolveUserDisplayName(bookingWithRelations.custodianUser)
        : bookingWithRelations.custodianTeamMember?.name;

      let title = bookingWithRelations.name;
      if (canSeeAllCustody) {
        title += ` | ${custodianName}`;
      }

      return {
        title,
        resourceId: bookingWithRelations.kitId,
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
          url: `/bookings/${bookingWithRelations.id}`,
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
