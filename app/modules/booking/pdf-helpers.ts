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
import { CHROME_EXECUTABLE_PATH, NODE_ENV, SERVER_URL } from "~/utils/env";
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
  defaultOrgImg: string | null;
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
                text-align: right;
                width: 100%;
                padding: 0 20px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                box-sizing: border-box;
                margin-bottom:30px;,
                font-family: Inter, sans-serif;
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
    executablePath:
      NODE_ENV !== "development"
        ? CHROME_EXECUTABLE_PATH || "/usr/bin/google-chrome-stable"
        : undefined,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
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
  await newPage.setContent(fullHtmlContent, { waitUntil: "networkidle0" });

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
