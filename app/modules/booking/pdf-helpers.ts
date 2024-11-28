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
import puppeteer from "puppeteer";
import { db } from "~/database/db.server";
import { CHROME_EXECUTABLE_PATH, NODE_ENV, SERVER_URL } from "~/utils/env";
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
  assetIdToQrCodeMap: Map<string, string>;
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

export const getBookingAssetsCustomHeader = ({
  organization,
  booking,
  defaultOrgImg,
}: PdfDbResult) => {
  const orgImageBlob = organization?.image?.blob;
  const base64Image = `data:image/png;base64,${
    orgImageBlob?.toString("base64") || defaultOrgImg
  }`;
  return `
        <style>
            .header {
                font-size: 10px;
                width: 100%;
                padding: 0 30px;
                box-sizing: border-box;
                font-family: Inter, sans-serif;
            }
            .header-main{
              display: flex;
              justify-content: space-between;
              align-items: center;
            }
            .header-main img {
              height: 40px;
              width: 40px;
              object-fit: cover;
            }
            .text {
              max-width: 400px; /* Adjust this value as needed */
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
              color: rgba(0, 0, 0, 0.6);
            }
            .header-content {
              display: flex;
              align-items: center;
              padding-left: 20px;
              overflow: hidden;
              gap:2px;
            } 
            .header-main .header-content {
              color:  rgba(0, 0, 0, 0.6);
            }
        </style>
        <div class="header">
            <div class="header-main">
            <img src="${base64Image}" alt="logo">
            <div class="header-content">
            <div class="text">${
              booking.name
            }</div><span> | ${new Date().toLocaleDateString()} | Page <span class="pageNumber"></span>/<span class="totalPages"></span></span>
            </div>
            </div>
        </div>
    `;
};

export async function generatePdfContent(
  htmlContent: string,
  pdfMeta: PdfDbResult,
  headerTemplate?: string,
  styles?: Record<string, string>
) {
  const browser = await puppeteer.launch({
    executablePath:
      NODE_ENV !== "development"
        ? CHROME_EXECUTABLE_PATH || "/usr/bin/chromium"
        : undefined,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--disable-software-rasterizer",
    ],
    // @ts-ignore
    headless: "new",
  });

  try {
    const fullHtmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap" rel="stylesheet">
      </head>
    <body class="bg-white">
      ${htmlContent}
    </body>
    </html>
  `;

    const newPage = await browser.newPage();

    await newPage.setContent(fullHtmlContent, {
      waitUntil: "networkidle0",
      timeout: 60000,
    });

    const pdfBuffer = await newPage.pdf({
      format: "A4",
      displayHeaderFooter: true,
      headerTemplate: headerTemplate || "",
      margin: {
        top: "120px",
        bottom: "30px",
        left: "20px",
        right: "20px",
        ...(styles || {}),
      },
    });

    return pdfBuffer;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Error generating PDF content",
      status: 500,
      label: "Booking",
      additionalData: {
        pdfMeta,
      },
    });
  } finally {
    // Ensures that the browser is closed, even in the case of an error(possible memory leak)
    if (browser) {
      await browser.close();
    }
  }
}
