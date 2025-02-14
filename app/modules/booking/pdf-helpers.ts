import type {
  Asset,
  Location,
  Category,
  Image,
  Organization,
  Custody,
  Prisma,
  Kit,
} from "@prisma/client";
import { OrganizationRoles } from "@prisma/client";
import { db } from "~/database/db.server";
import { SERVER_URL } from "~/utils/env";
import { ShelfError } from "~/utils/error";
import { getBooking } from "./service.server";
import { getQrCodeMaps } from "../qr/service.server";

export interface PdfDbResult {
  booking: Prisma.BookingGetPayload<{
    include: { custodianTeamMember: true; custodianUser: true };
  }>;
  assets: (Asset & {
    category: Category | null;
    location: Location | null;
    custody: Custody | null;
    kit: Kit | null;
  })[];
  organization: (Partial<Organization> & { image: Image | null }) | null;
  assetIdToQrCodeMap: Record<string, string>;
  defaultOrgImg: string | null;
  from?: string;
  to?: string;
}

async function getImageAsBase64(url: string) {
  try {
    // Fetch the image data
    const response = await fetch(url);

    const arrayBuffer = await response.arrayBuffer();

    // Convert the image data to a Base64-encoded string
    const base64Image = Buffer.from(arrayBuffer).toString("base64");

    return base64Image;

    // Convert the image data to a Base64-encoded string
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error fetching image:", error);
    return null;
  }
}

export async function fetchAllPdfRelatedData(
  bookingId: string,
  organizationId: string,
  userId: string,
  role: OrganizationRoles | undefined
): Promise<PdfDbResult> {
  try {
    const booking = await getBooking({ id: bookingId, organizationId });

    if (
      role === OrganizationRoles.SELF_SERVICE &&
      booking.custodianUserId !== userId
    ) {
      throw new ShelfError({
        cause: null,
        message: "You are not authorized to view this booking",
        status: 403,
        label: "Booking",
        shouldBeCaptured: false,
      });
    }

    const [assets, organization, defaultOrgImg] = await Promise.all([
      db.asset.findMany({
        where: {
          id: { in: booking?.assets.map((a) => a.id) || [] },
        },
        include: {
          category: true,
          custody: true,
          qrCodes: true,
          location: true,
          bookings: {
            where: {
              ...(booking?.from && booking?.to
                ? {
                    status: { in: ["RESERVED", "ONGOING", "OVERDUE"] },
                    OR: [
                      { from: { lte: booking.to }, to: { gte: booking.from } },
                      { from: { gte: booking.from }, to: { lte: booking.to } },
                    ],
                  }
                : {}),
            },
          },
          kit: true,
        },
      }),
      db.organization.findUnique({
        where: { id: organizationId },
        select: { imageId: true, name: true, id: true, image: true },
      }),
      getImageAsBase64(`${SERVER_URL}/static/images/asset-placeholder.jpg`),
    ]);

    const assetIdToQrCodeMap = await getQrCodeMaps({
      assets,
      userId,
      organizationId,
      size: "small",
    });
    return {
      booking,
      assets,
      organization,
      assetIdToQrCodeMap,
      defaultOrgImg,
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
