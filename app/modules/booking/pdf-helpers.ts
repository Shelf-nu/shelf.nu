import type {
  Asset,
  Location,
  Category,
  Organization,
  Prisma,
  Kit,
  OrganizationRoles,
} from "@prisma/client";
import { db } from "~/database/db.server";
import { validateBookingOwnership } from "~/utils/booking-authorization.server";
import { calculateTotalValueOfAssets } from "~/utils/bookings";
import { getClientHint } from "~/utils/client-hints";
import { ShelfError } from "~/utils/error";
import { getBooking } from "./service.server";
import { getQrCodeMaps } from "../qr/service.server";

export interface PdfDbResult {
  booking: Prisma.BookingGetPayload<{
    include: {
      custodianTeamMember: true;
      custodianUser: true;
      tags: { select: { id: true; name: true } };
    };
  }>;
  assets: (Asset & {
    category: Pick<Category, "name"> | null;
    location: Pick<Location, "name"> | null;
    kit: Pick<Kit, "name"> | null;
  })[];
  totalValue: string;
  organization: Pick<
    Organization,
    "id" | "name" | "imageId" | "currency" | "updatedAt"
  >;
  assetIdToQrCodeMap: Record<string, string>;
  from?: string;
  to?: string;
  originalFrom?: string;
  originalTo?: string;
}

export async function fetchAllPdfRelatedData(
  bookingId: string,
  organizationId: string,
  userId: string,
  role: OrganizationRoles | undefined,
  request: Request
): Promise<PdfDbResult> {
  try {
    const booking = await getBooking({
      id: bookingId,
      organizationId,
      request,
      extraInclude: { tags: { select: { id: true, name: true } } },
    });

    if (role) {
      validateBookingOwnership({
        booking,
        userId,
        role,
        action: "view",
        checkCustodianOnly: true,
      });
    }

    const [assets, organization] = await Promise.all([
      db.asset.findMany({
        where: {
          id: { in: booking?.assets.map((a) => a.id) || [] },
        },
        include: {
          category: {
            select: {
              name: true,
            },
          },
          qrCodes: true,
          location: {
            select: {
              name: true,
            },
          },
          kit: {
            select: {
              name: true,
            },
          },
        },
      }),
      db.organization.findUnique({
        where: { id: organizationId },
        select: {
          imageId: true,
          name: true,
          id: true,
          currency: true,
          updatedAt: true,
        },
      }),
    ]);

    if (!organization) {
      throw new ShelfError({
        cause: null,
        message: "Organization not found",
        status: 404,
        label: "Organization",
      });
    }

    const assetIdToQrCodeMap = await getQrCodeMaps({
      assets,
      userId,
      organizationId,
      size: "small",
    });
    return {
      booking,
      assets,
      totalValue: calculateTotalValueOfAssets({
        assets: booking.assets,
        currency: organization.currency,
        locale: getClientHint(request).locale,
      }),
      organization,
      assetIdToQrCodeMap,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Error fetching booking data for PDF",
      status: 500,
      label: "Booking",
    });
  }
}
