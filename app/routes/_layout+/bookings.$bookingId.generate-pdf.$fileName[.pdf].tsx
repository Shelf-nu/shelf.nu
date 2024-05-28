import fs from "fs/promises";
import path from "path";
import { OrganizationRoles } from "@prisma/client";
import { json, redirect } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import * as ejs from "ejs";
import puppeteer from "puppeteer";
import { z } from "zod";
import { db } from "~/database/db.server";
import { getBooking } from "~/modules/booking/service.server";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import { getQrCodeMaps } from "~/modules/qr/service.server";
import {
  setCookie,
  updateCookieWithPerPage,
  userPrefs,
} from "~/utils/cookies.server";
import { ShelfError, makeShelfError } from "~/utils/error";

import { error, getCurrentSearchParams, getParams } from "~/utils/http.server";
import { getParamsValues } from "~/utils/list";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.validator.server";
import { requirePermission } from "~/utils/roles.server";

interface Item {
  name: string;
  category: string;
  location: string;
  code: string;
  mainImage: string;
}

interface Data {
  booking: string;
  name: string;
  custodian: string;
  bookingPeriod: string;
  items: Item[];
  orgName: string;
}

const getCustomHeader = (base64Image?: string, bookName?: string) => `
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
            bookName || ""
          } | 04/30/2024 | Page <span class="pageNumber"></span>/<span class="totalPages"></span></span>
      </div>
  `;

export const loader = async ({
  context,
  request,
  params,
}: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { bookingId } = getParams(
    params,
    z.object({
      bookingId: z.string(),
    }),
    {
      additionalData: { userId },
    }
  );

  try {
    const { organizationId, role } = await requirePermission({
      userId: authSession?.userId,
      request,
      entity: PermissionEntity.booking,
      action: PermissionAction.read,
    });

    const searchParams = getCurrentSearchParams(request);
    /**
     * If the org id in the params is different than the current organization id,
     * we need to redirect and set the organization id in the cookie
     * This is useful when the user is viewing a booking from a different organization that they are part of after clicking link in email
     */
    const orgId = searchParams.get("orgId");
    if (orgId && orgId !== organizationId) {
      return redirect(`/bookings/${bookingId}`, {
        headers: [setCookie(await setSelectedOrganizationIdCookie(orgId))],
      });
    }

    const isSelfService = role === OrganizationRoles.SELF_SERVICE;
    const booking = await getBooking({
      id: bookingId,
      organizationId: organizationId,
    });

    /** For self service users, we only allow them to read their own bookings */
    if (isSelfService && booking.custodianUserId !== authSession.userId) {
      throw new ShelfError({
        cause: null,
        message: "You are not authorized to view this booking",
        status: 403,
        label: "Booking",
        shouldBeCaptured: false,
      });
    }

    const [org, assets] = await Promise.all([
      /** We create a teamMember entry to represent the org owner.
       * Most important thing is passing the ID of the owner as the userId as we are currently only supporting
       * assigning custody to users, not NRM.
       */
      db.organization.findUnique({
        where: {
          id: organizationId,
        },
        select: {
          owner: true,
          imageId: true,
          name: true,
          id: true,
          image: true,
        },
      }),
      /**
       * We need to do this in a separate query because we need to filter the bookings within an asset based on the booking.from and booking.to
       * That way we know if the asset is available or not because we can see if they are booked for the same period
       */
      db.asset.findMany({
        where: {
          id: {
            in: booking?.assets.map((a) => a.id) || [],
          },
        },
        include: {
          category: true,
          custody: true,
          qrCodes: true,
          location: true,
          bookings: {
            where: {
              // id: { not: booking.id },
              ...(booking.from && booking.to
                ? {
                    status: { in: ["RESERVED", "ONGOING", "OVERDUE"] },
                    OR: [
                      {
                        from: { lte: booking.to },
                        to: { gte: booking.from },
                      },
                      {
                        from: { gte: booking.from },
                        to: { lte: booking.to },
                      },
                    ],
                  }
                : {}),
            },
          },
        },
      }),
    ]);

    /** We replace the assets ids in the booking object with the assets fetched in the separate request.
     * This is useful for more consistent data in the front-end */
    booking.assets = assets

    const { perPageParam } = getParamsValues(searchParams);
    const cookie = await updateCookieWithPerPage(request, perPageParam);
    const qrData = (await getQrCodeMaps({
      assets,
      userId,
      organizationId,
      size: "small",
    })) as Array<any>;

    const qrCodesMap = qrData?.reduce((obj, [key, value]) => {
      if (key) {
        obj[key] = value;
      }
      return obj;
    }, {});

    const cookieData = await userPrefs.serialize(cookie);
    const data: Data = {
      booking: `Booking Checklist for ${booking.name}`,
      name: booking.name ?? "",
      orgName: org?.name ?? "",
      custodian: `${booking?.custodianUser?.firstName ?? ""} ${
        booking?.custodianUser?.lastName ?? ""
      } <${booking?.custodianUser?.email ?? ""}>`,
      bookingPeriod:
        booking?.from && booking?.to
          ? `${new Date(booking.from).toLocaleString()} - ${new Date(
              booking.to
            ).toLocaleString()}`
          : "",
      items: assets?.map(
        (asset) => ({
          name: asset.title ?? "",
          category: asset?.category?.name ?? "",
          location: asset?.location ? asset?.location?.name ?? "" : "",
          code: qrCodesMap?.[asset.id]?.src || "",
          mainImage: asset?.mainImage || "",
        })
      ),
    };

    // Generate PDF using Puppeteer
    const templatePath = path.resolve(
      process.cwd(),
      "./app/views/booking-assets-template.ejs"
    );
    const template = await fs.readFile(templatePath, "utf-8");
    const htmlContent = ejs.render(template, data);

    // Generate PDF using Puppeteer
    const browser = await puppeteer.launch();
    const newPage = await browser.newPage();
    await newPage.setContent(htmlContent, { waitUntil: "networkidle0" });

    const base64Image = org?.image?.blob
      ? `data:image/png;base64,${org?.image?.blob.toString("base64")}`
      : "";

    // Generate the PDF with header and footer
    const pdfBuffer = await newPage.pdf({
      format: "A4",
      displayHeaderFooter: true,
      headerTemplate: getCustomHeader(base64Image, booking?.name),
      margin: {
        top: "80px",
        bottom: "30px",
        left: "20px",
        right: "20px",
      },
    });

    await browser.close();

    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "set-cookie": cookieData,
      },
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, bookingId });
    throw json(error(reason), { status: reason.status });
  }
};
