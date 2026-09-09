import { useMemo } from "react";
import { AssetType } from "@prisma/client";
import type { useLoaderData } from "react-router";
import { useCurrentOrganization } from "~/hooks/use-current-organization";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import type { AdvancedAssetBooking } from "~/modules/asset/types";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";
import {
  RETURNED_EVENT_CLASS,
  availabilityEventClassNames,
} from "~/utils/calendar";
import { useHints } from "~/utils/client-hints";
import { toIsoDateTimeToUserTimezone } from "~/utils/date-fns";
import type { OrganizationPermissionSettings } from "~/utils/permissions/custody-and-bookings-permissions.validator.client";
import { userHasCustodyViewPermission } from "~/utils/permissions/custody-and-bookings-permissions.validator.client";
import { resolveUserDisplayName } from "~/utils/user";

type Items = NonNullable<
  ReturnType<typeof useLoaderData<AssetIndexLoaderData>>["items"]
>;

/** One BookingAsset pivot slice normalized from either loader shape. */
type BookingSlice = {
  booking: AdvancedAssetBooking;
  assetKitId: string | null;
  kitName: string | null;
  quantity: number;
  checkedOutAt: string | Date | null;
  checkedInAt: string | Date | null;
};

/** Simple-mode `asset.bookingAssets[]` element: pivot row + nested booking.
 * The Prisma include returns every BookingAsset scalar, so the two slice
 * markers arrive here as Dates without being named in the loader's select. */
type SimpleModeBookingAsset = {
  booking: AdvancedAssetBooking;
  assetKitId?: string | null;
  kitName?: string | null;
  quantity?: number;
  checkedOutAt?: string | Date | null;
  checkedInAt?: string | Date | null;
};

/** Slice markers the returned rule reads; both loader shapes carry them. */
type SliceMarkers = Pick<BookingSlice, "checkedOutAt" | "checkedInAt">;

const toMillis = (value: string | Date) => new Date(value).getTime();

/** Milliseconds a returned bar spans when the check-in precedes the booking's
 * start (early check-out without a date adjustment, then a return): the
 * calendar needs an end after the start, and one hour keeps the bar visible. */
const MIN_RETURNED_BAR_MS = 60 * 60 * 1000;

/**
 * Whether ONE slice has come back from its booking. A departure clears
 * `checkedInAt`, but rows stamped by the check-in backfill can carry a
 * `checkedInAt` older than their `checkedOutAt`; only a check-in at or after
 * the departure means the slice is back — the same test the booking's own
 * completion gate applies.
 */
export function isSliceReturned(slice: SliceMarkers): boolean {
  if (!slice.checkedInAt) return false;
  if (!slice.checkedOutAt) return true;
  return toMillis(slice.checkedInAt) >= toMillis(slice.checkedOutAt);
}

/**
 * The instant an asset's bar should end for one booking: the latest check-in
 * across its folded slices, or null when the asset is still booked or out.
 *
 * Only a live booking can have a returned asset. A RESERVED booking has not
 * started, so its slices are drawn for the whole planned period whatever
 * markers they carry. A QUANTITY_TRACKED slice gets `checkedInAt` only once
 * every booked unit is back; a partly returned pool keeps its full bar (its
 * flow back is tracked by ConsumptionLog, not drawn here).
 */
export function resolveReturnedAt(
  status: AdvancedAssetBooking["status"],
  slices: SliceMarkers[]
): string | null {
  if (status !== "ONGOING" && status !== "OVERDUE") return null;
  if (slices.length === 0 || !slices.every(isSliceReturned)) return null;
  const latest = Math.max(
    ...slices.map((s) => toMillis(s.checkedInAt as string | Date))
  );
  return new Date(latest).toISOString();
}

/**
 * The bar end for a returned asset. The calendar drops an end that is not
 * after the start and draws a default-length bar instead, so a check-in
 * recorded before the booking's (unadjusted) start is pushed to one hour
 * after it.
 */
export function returnedBarEnd(
  returnedAt: string,
  from: string | Date
): string {
  const start = toMillis(from);
  const end = toMillis(returnedAt);
  return end > start
    ? returnedAt
    : new Date(start + MIN_RETURNED_BAR_MS).toISOString();
}

export function useAssetAvailabilityData(items: Items) {
  const { roles } = useUserRoleHelper();
  const organization = useCurrentOrganization();
  const canSeeAllCustody = userHasCustodyViewPermission({
    roles,
    organization: organization as OrganizationPermissionSettings,
  });

  const { timeZone } = useHints();

  const { resources, events } = useMemo(() => {
    const safeItems = items ?? [];
    const resources = safeItems.map((item) => {
      // Normalize code-resolution fields across simple-mode shape (has
      // `qrCodes` relation + `preferredBarcodeId`) and advanced-mode shape
      // (`AdvancedIndexAsset` has a flat `qrId: string` and no
      // `preferredBarcodeId`). Both shapes carry `sequentialId` + `barcodes`.
      const preferredBarcodeId =
        "preferredBarcodeId" in item ? item.preferredBarcodeId : null;
      const qrCodes =
        "qrCodes" in item && Array.isArray(item.qrCodes) && item.qrCodes.length
          ? item.qrCodes
          : "qrId" in item && item.qrId
          ? [{ id: item.qrId }]
          : [];

      return {
        id: item.id,
        title: item.title,
        extendedProps: {
          mainImage: item.mainImage,
          thumbnailImage: item.thumbnailImage,
          mainImageExpiration: item.mainImageExpiration,
          // Carried through so the availability view renders the model's cover
          // image for assets that have none of their own, same as every other
          // asset surface (see `~/modules/asset/image-resolution`).
          assetModel: item.assetModel ?? null,
          status: item.status,
          availableToBook: item.availableToBook,
          category: item.category,
          // Passed through to `resourceLabelContent` in `assets-list.tsx`
          // so the chip renders consistently with every other code-bearing
          // surface (see .claude/rules/code-bearing-entity-list-consistency.md).
          sequentialId: item.sequentialId,
          preferredBarcodeId,
          qrCodes,
          barcodes: item.barcodes ?? [],
        },
      };
    });

    const events = safeItems.flatMap((asset) => {
      // The availability calendar is fed by two loaders with two booking
      // shapes: simple mode (`data.server.ts`) includes the `BookingAsset`
      // pivot relation → `asset.bookingAssets: { booking }[]`, while advanced
      // mode (`query.server.ts` raw SQL) aggregates the pivot into a flat
      // `asset.bookings: AdvancedAssetBooking[]`. Normalize both into per-slice
      // records that keep the pivot-level metadata (assetKitId, quantity,
      // kitName) alongside the booking — simple mode carries these on the
      // BookingAsset pivot row; advanced mode carries them on each flattened
      // booking element.
      const slices: BookingSlice[] =
        "bookingAssets" in asset && asset.bookingAssets
          ? (asset.bookingAssets as unknown as SimpleModeBookingAsset[]).map(
              (ba) => ({
                booking: ba.booking,
                assetKitId: ba.assetKitId ?? null,
                kitName: ba.kitName ?? null,
                quantity: ba.quantity ?? 1,
                checkedOutAt: ba.checkedOutAt ?? null,
                checkedInAt: ba.checkedInAt ?? null,
              })
            )
          : "bookings" in asset && asset.bookings
          ? (asset.bookings as unknown as AdvancedAssetBooking[]).map((b) => ({
              booking: b,
              assetKitId: b.assetKitId ?? null,
              kitName: b.kitName ?? null,
              quantity: b.quantity ?? 1,
              checkedOutAt: b.checkedOutAt ?? null,
              checkedInAt: b.checkedInAt ?? null,
            }))
          : [];

      // Quantities are only meaningful for QUANTITY_TRACKED assets. An
      // INDIVIDUAL asset is a single physical unit (always qty 1), so the bar
      // hides the per-slice `Qty` and the booked-units total for it — showing
      // "Qty 1" on an individual asset booked via a kit is redundant noise.
      const quantityTracked = asset.type === AssetType.QUANTITY_TRACKED;

      // Collapse slices that share a booking into ONE event. Lossless:
      // BookingAsset carries no dates, so every slice of a booking shares
      // booking.from/to/status/name — only per-slice kit/quantity differs.
      // Keyed within THIS asset's slice list, so the same booking across
      // different assets stays as distinct resource rows.
      const groups = new Map<string, BookingSlice[]>();
      for (const slice of slices) {
        const existing = groups.get(slice.booking.id);
        if (existing) existing.push(slice);
        else groups.set(slice.booking.id, [slice]);
      }

      return Array.from(groups.values()).map((group) => {
        const booking = group[0].booking;
        const custodianName = booking?.custodianUser
          ? resolveUserDisplayName(booking.custodianUser)
          : booking.custodianTeamMember?.name;

        // Every folded slice of this asset is back from a live booking: the
        // bar stops at the check-in and is drawn as settled, while the
        // booking keeps its live status (ONGOING or OVERDUE) until it is
        // completed. Slices that never went out on this booking keep the
        // planned bar.
        const returnedAt = resolveReturnedAt(booking.status, group);
        const returned = returnedAt !== null;

        let title = booking.name;
        if (canSeeAllCustody) {
          title += ` | ${custodianName}`;
        }

        // Per-slice breakdown for the collapsed bar. `quantity` is always
        // BookingAsset.quantity (booked units), never Asset.quantity.
        const availabilitySlices = group.map((s) => ({
          assetKitId: s.assetKitId,
          kitName: s.kitName,
          quantity: s.quantity,
        }));
        const bookedTotal = availabilitySlices.reduce(
          (sum, s) => sum + s.quantity,
          0
        );

        const barEnd = returnedAt
          ? returnedBarEnd(returnedAt, booking.from)
          : booking.to;

        return {
          title,
          resourceId: asset.id,
          start: toIsoDateTimeToUserTimezone(booking.from, timeZone),
          end: toIsoDateTimeToUserTimezone(barEnd, timeZone),
          classNames: [
            `bookingId-${booking.id}`,
            ...(returned ? [RETURNED_EVENT_CLASS] : []),
            // Same rule the calendar's own class callback applies, so the bar
            // is drawn the same way from both sides.
            ...availabilityEventClassNames(
              { status: booking.status, returned },
              new Date(booking.from),
              new Date(booking.to),
              "px-1"
            ),
          ],
          extendedProps: {
            url: `/bookings/${booking.id}`,
            id: booking.id,
            name: booking.name,
            status: booking.status,
            returned,
            returnedAt,
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
                    ? resolveUserDisplayName(booking.creator)
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
            slices: availabilitySlices,
            sliceCount: availabilitySlices.length,
            bookedTotal,
            quantityTracked,
          },
        };
      });
    });

    return { resources, events };
  }, [canSeeAllCustody, items, timeZone]);

  return {
    resources,
    events,
  };
}
