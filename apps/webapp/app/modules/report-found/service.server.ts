import type { Asset, Kit, Prisma, ReportFound, User } from "@prisma/client";
import { db } from "~/database/db.server";
import { sendEmail } from "~/emails/mail.server";
import type { QR_SELECT_FOR_REPORT } from "~/routes/qr+/_public+/$qrId_.contact-owner";
import { ShelfError } from "~/utils/error";
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

export function sendReportEmails({
  ownerEmail,
  message,
  reporterEmail,
  qr,
}: {
  ownerEmail: User["email"];
  message: ReportFound["content"];
  reporterEmail: ReportFound["email"];
  qr: Prisma.QrGetPayload<{
    select: typeof QR_SELECT_FOR_REPORT;
  }>;
}) {
  const { item, type, normalizedName } = normalizeQrData(qr);
  const isUnlinked = !qr.assetId && !qr.kitId;

  const subject = isUnlinked
    ? "Reported unlinked qr found"
    : `Reported ${type} found`;

  try {
    /** Send email to owner */
    sendEmail({
      to: ownerEmail,
      subject,
      text: item
        ? `Your ${type} ${normalizedName} has been reported found. The reason is: \n\n| ${message} \n\n For contact use this email: ${reporterEmail}\n\nEmail sent via shelf.nu\n\n`
        : `The QR code own (${qr.id}) has been reported found. The reason is: \n\n| ${message} \n\n For contact use this email: ${reporterEmail}\n\nEmail sent via shelf.nu\n\n`,
    });

    /** Send email to reporter */
    sendEmail({
      to: reporterEmail,
      subject,
      text: item
        ? `Thank you for contacting the owner of the ${type} you found. They have been notified of your message and will contact you if they are interested.\n\nEmail sent via shelf.nu\n\n`
        : `Thank you for contacting the owner of the QR code you found. They have been notified of your message and will contact you if they are interested.\n\nEmail sent via shelf.nu\n\n`,
    });

    return;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to send report emails",
      additionalData: { ownerEmail, reporterEmail, item, type, normalizedName },
      label: "Report",
    });
  }
}
