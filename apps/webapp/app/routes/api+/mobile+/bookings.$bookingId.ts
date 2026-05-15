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
        // Phase 3a: walk the BookingAsset pivot to reach assets. The select
        // shape below mirrors what main's mobile contract expected on the
        // implicit M2M, but each row is now `{ asset: {...} }`.
        bookingAssets: {
          select: {
            asset: {
              select: {
                id: true,
                title: true,
                status: true,
                mainImage: true,
                category: {
                  select: { id: true, name: true, color: true },
                },
                // Pull the asset's kit through the `AssetKit` pivot.
                // `@@unique([assetId])` keeps the link 1:1, so the first
                // pivot row (oldest by createdAt) is a lossless "primary
                // kit" for mobile clients that expect a singular shape.
                assetKits: {
                  select: { kit: { select: { id: true, name: true } } },
                  orderBy: { createdAt: "asc" },
                  take: 1,
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

    // Synthesise singular `kit` / `kitId` keys from the `AssetKit` pivot
    // so the mobile JSON contract stays flat — clients consume a single
    // kit per asset, not the pivot array. We also strip the raw
    // `assetKits` field from the response.
    const assets = booking.bookingAssets.map((ba) => {
      const { assetKits, ...rest } = ba.asset;
      const primaryKit = assetKits[0]?.kit ?? null;
      return {
        ...rest,
        kit: primaryKit,
        kitId: primaryKit?.id ?? null,
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
