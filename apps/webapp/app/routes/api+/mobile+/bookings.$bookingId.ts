import { AssetStatus } from "@prisma/client";
import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { getPartiallyCheckedInAssetIds } from "~/modules/booking/service.server";
import { makeShelfError } from "~/utils/error";
import { getParams } from "~/utils/http.server";

/**
 * GET /api/mobile/bookings/:bookingId
 *
 * Returns full booking detail with assets, custodian, and check-in status.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    const { bookingId } = getParams(
      params,
      z.object({ bookingId: z.string().min(1) })
    );

    const booking = await db.booking.findFirst({
      where: { id: bookingId, organizationId },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        from: true,
        to: true,
        createdAt: true,
        updatedAt: true,
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        custodianUser: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            profilePicture: true,
          },
        },
        custodianTeamMember: {
          select: {
            id: true,
            name: true,
          },
        },
        // Walk the BookingAsset pivot to reach assets. `quantity` +
        // `assetKitId` per row let the loader below collapse multi-row
        // entries (standalone + kit-driven slices of the same asset)
        // into one mobile-shape entry per asset.
        bookingAssets: {
          select: {
            id: true,
            quantity: true,
            assetKitId: true,
            asset: {
              select: {
                id: true,
                title: true,
                status: true,
                mainImage: true,
                category: {
                  select: { id: true, name: true, color: true },
                },
                // Pull the asset's kit memberships through the `AssetKit`
                // pivot. `id` so we can match the BookingAsset's
                // `assetKitId` against the right membership when collapsing.
                assetKits: {
                  select: {
                    id: true,
                    kit: { select: { id: true, name: true } },
                  },
                  orderBy: { createdAt: "asc" },
                },
              },
            },
          },
          orderBy: [
            { asset: { status: "desc" } },
            { asset: { createdAt: "asc" } },
          ],
        },
        _count: {
          select: { bookingAssets: true },
        },
      },
    });

    if (!booking) {
      return data({ error: { message: "Booking not found" } }, { status: 404 });
    }

    // Get partial check-in data for ONGOING/OVERDUE bookings
    let checkedInAssetIds: string[] = [];
    if (booking.status === "ONGOING" || booking.status === "OVERDUE") {
      checkedInAssetIds = await getPartiallyCheckedInAssetIds(booking.id);
    }

    // Collapse multi-row BookingAsset entries to one mobile shape per
    // `assetId`. Sum the quantities; expose `assetKitId` only when
    // every row for the asset agrees on the same kit (otherwise `null`
    // = mixed standalone + kit-driven). Mobile clients that don't know
    // about `assetKitId` see the same flat shape they always did.
    //
    // `kit`/`kitId` keep their legacy synthesis (the first AssetKit
    // pointer the asset has at booking time) for older clients that
    // still rely on those — but the `assetKitId` field is the accurate
    // per-booking-slice signal when mobile is ready to adopt it.
    type CollapsedRow = {
      assetId: string;
      first: (typeof booking.bookingAssets)[number];
      totalQuantity: number;
      assetKitIds: Set<string | null>;
    };
    const byAssetId = new Map<string, CollapsedRow>();
    for (const ba of booking.bookingAssets) {
      const existing = byAssetId.get(ba.asset.id);
      if (existing) {
        existing.totalQuantity += ba.quantity;
        existing.assetKitIds.add(ba.assetKitId);
      } else {
        byAssetId.set(ba.asset.id, {
          assetId: ba.asset.id,
          first: ba,
          totalQuantity: ba.quantity,
          assetKitIds: new Set([ba.assetKitId]),
        });
      }
    }

    const assets = Array.from(byAssetId.values()).map((row) => {
      const { assetKits, ...rest } = row.first.asset;
      const primaryKit = assetKits[0]?.kit ?? null;
      // Unanimous-kit rule: every collapsed row for this asset points at
      // the same `assetKitId`. Mixed → `null` so clients don't
      // mis-attribute the slice to one of multiple sources.
      const unanimousAssetKitId =
        row.assetKitIds.size === 1 ? Array.from(row.assetKitIds)[0] : null;
      return {
        ...rest,
        kit: primaryKit,
        kitId: primaryKit?.id ?? null,
        // Per-booking quantity (sum of all slices for this asset in
        // this booking).
        quantity: row.totalQuantity,
        // Per-row kit-source discriminator — `null` for standalone or
        // mixed (assets with both standalone and kit-driven slices).
        assetKitId: unanimousAssetKitId,
      };
    });

    // Compute booking capability flags
    const checkedOutCount = assets.filter(
      (a) => a.status === AssetStatus.CHECKED_OUT
    ).length;
    const totalAssets = assets.length;

    const canCheckout = booking.status === "RESERVED" && totalAssets > 0;
    const canCheckin =
      (booking.status === "ONGOING" || booking.status === "OVERDUE") &&
      checkedOutCount > 0;

    return data({
      booking: {
        id: booking.id,
        name: booking.name,
        description: booking.description,
        status: booking.status,
        from: booking.from,
        to: booking.to,
        createdAt: booking.createdAt,
        updatedAt: booking.updatedAt,
        creator: booking.creator,
        custodianUser: booking.custodianUser,
        custodianTeamMember: booking.custodianTeamMember,
        assets,
        assetCount: totalAssets,
        checkedOutCount,
      },
      checkedInAssetIds,
      canCheckout,
      canCheckin,
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
