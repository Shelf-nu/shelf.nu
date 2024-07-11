import type { Asset, Kit, Prisma, ReportFound, User } from "@prisma/client";
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import { sendEmail } from "~/utils/mail.server";
import { normalizeQrData } from "~/utils/qr";

export async function createReport({
  email,
  content,
  assetId,
  kitId,
}: Pick<ReportFound, "email" | "content"> & {
  assetId?: Asset["id"];
  kitId?: Kit["id"];
}) {
  try {
    return await db.reportFound.create({
      data: {
        email,
        content,
        ...(assetId && {
          asset: {
            connect: {
              id: assetId,
            },
          },
        }),

        ...(kitId && {
          kit: {
            connect: {
              id: kitId,
            },
          },
        }),
      },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while creating the report. Please try again or contact support.",
      additionalData: { email, content, assetId, kitId },
      label: "Report",
    });
  }
}

export async function sendReportEmails({
  owner,
  message,
  reporterEmail,
  qr,
}: {
  owner: User;
  message: ReportFound["content"];
  reporterEmail: ReportFound["email"];
  qr: Prisma.QrGetPayload<{
    include: {
      asset: true;
      kit: true;
    };
  }>;
}) {
  const { item, type, normalizedName } = normalizeQrData(qr);

  try {
    return await Promise.all([
      /** Send email to owner */
      sendEmail({
        to: owner.email,
        subject: `Reported ${type}`,
        text: item
          ? `Your ${type} ${normalizedName} has been reported found. The reason is: \n\n| ${message} \n\n For contact use this email: ${reporterEmail}\n\nEmail sent via shelf.nu`
          : `Your ${type} you own has been reported found. The reason is: \n\n| ${message} \n\n For contact use this email: ${reporterEmail}\n\nEmail sent via shelf.nu`,
      }),

      /** Send email to reporter */
      sendEmail({
        to: reporterEmail,
        subject: `Reported ${type}`,
        text: `Thank you for contacting the owner of the ${type} you found. They have been notified of your message and will contact you if they are interested.\n\nEmail sent via shelf.nu`,
      }),
    ]);
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to send report emails",
      additionalData: { owner, reporterEmail, item, type, normalizedName },
      label: "Report",
    });
  }
}
