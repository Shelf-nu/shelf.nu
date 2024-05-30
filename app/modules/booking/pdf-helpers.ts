import type {
  Asset,
  Booking,
  Location,
  Category,
  Image,
  Organization,
  Custody,
  User,
} from "@prisma/client";
import { OrganizationRoles } from "@prisma/client";
import puppeteer from "puppeteer";
import { db } from "~/database/db.server";
import { CHROME_EXECUTABLE_PATH } from "~/utils/env";
import { ShelfError } from "~/utils/error";
import { getBooking } from "./service.server";
import { getQrCodeMaps } from "../qr/service.server";

export interface PdfDbResult {
  booking: Booking & { custodianUser: User | null };
  assets: (Asset & {
    category: Category | null;
    location: Location | null;
    custody: Custody | null;
  })[];
  organization: (Partial<Organization> & { image: Image | null }) | null;
  assetIdToQrCodeMap: Map<string, string>;
}

export async function fetchAllPdfRelatedData(
  bookingId: string,
  organizationId: string,
  userId: string,
  role: OrganizationRoles | undefined
): Promise<PdfDbResult> {
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

  const [assets, organization] = await Promise.all([
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
      },
    }),
    db.organization.findUnique({
      where: { id: organizationId },
      select: { imageId: true, name: true, id: true, image: true },
    }),
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
  };
}

export const getBookingAssetsCustomHeader = ({
  organization,
  booking,
}: PdfDbResult) => {
  const orgImageBlob = organization?.image?.blob;
  const base64Image = orgImageBlob
    ? `data:image/png;base64,${orgImageBlob.toString("base64")}`
    : "";
  return `
        <style>
            .header {
                font-size: 10px;
                text-align: right;
                width: 100%;
                padding: 0 20px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                box-sizing: border-box;
                margin-bottom:30px;
            }
            .header img {
                height: 40px;
                width: 40px;
                object-fit: cover
            }
            .header .text {
                text-align: right;
                color: rgba(0, 0, 0, 0.6);
            }
        </style>
        <div class="header">
            <img src="${base64Image}" alt="logo">
            <span class="text">${
              booking?.name || ""
            } | <span class="date"></span> | Page <span class="pageNumber"></span>/<span class="totalPages"></span></span>
        </div>
    `;
};

export async function generatePdfContent(
  htmlContent: string,
  headerTemplate?: string,
  styles?: Record<string, string>
) {
  const browser = await puppeteer.launch({
    executablePath: CHROME_EXECUTABLE_PATH || "/usr/bin/google-chrome-stable",
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox'
  ]
  });
  const newPage = await browser.newPage();
  await newPage.setContent(htmlContent, { waitUntil: "networkidle0" });

  const pdfBuffer = await newPage.pdf({
    format: "A4",
    displayHeaderFooter: true,
    headerTemplate: headerTemplate || "",
    margin: {
      top: "80px",
      bottom: "30px",
      left: "20px",
      right: "20px",
      ...(styles || {}),
    },
  });

  await browser.close();
  return pdfBuffer;
}
