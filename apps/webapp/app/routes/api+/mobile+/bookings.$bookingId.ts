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
        assets: {
          select: {
            id: true,
            title: true,
            status: true,
            mainImage: true,
            kitId: true,
            category: {
              select: { id: true, name: true, color: true },
            },
            kit: {
              select: { id: true, name: true },
            },
          },
          orderBy: [{ status: "desc" }, { createdAt: "asc" }],
        },
        _count: {
          select: { assets: true },
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

    // Compute booking capability flags
    const checkedOutCount = booking.assets.filter(
      (a) => a.status === AssetStatus.CHECKED_OUT
    ).length;
    const totalAssets = booking.assets.length;

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
        assets: booking.assets,
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
