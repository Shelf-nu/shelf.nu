import type { Asset, Kit, Prisma, ReportFound, User } from "@prisma/client";
import { db } from "~/database/db.server";
import { sendEmail } from "~/emails/mail.server";
import { SERVER_URL } from "~/utils/env";
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

export async function sendReportEmails({
  ownerEmail,
  message,
  reporterEmail,
  qr,
}: {
  ownerEmail: User["email"];
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
  const isUnlinked = !qr.assetId && !qr.kitId;

  const subject = isUnlinked
    ? "Someone scanned your unlinked QR code"
    : `Someone found your ${type}: ${normalizedName}`;

  try {
    return await Promise.all([
      /** Send email to owner */
      sendEmail({
        to: ownerEmail,
        subject,
        text: item
          ? `Howdy,\n\nYour ${type} ${normalizedName} was reported found.\n\n**Message from finder:**\n${message}\n\n**Contact them:** ${reporterEmail}\n\n→ View ${type}: ${SERVER_URL}/${type}s/${item.id}\n\nThanks,\nThe Shelf Team\n\n---\nEmail sent via shelf.nu\n\n`
          : `Howdy,\n\nYour QR code (${qr.id}) was reported found, but it's not linked to an asset yet.\n\n**Message from finder:**\n${message}\n\n**Contact them:** ${reporterEmail}\n\n→ Link this QR: ${SERVER_URL}/qr/${qr.id}\n\nThanks,\nThe Shelf Team\n\n---\nEmail sent via shelf.nu\n\n`,
      }),

      /** Send email to reporter */
      sendEmail({
        to: reporterEmail,
        subject: "Thanks for reporting",
        text: item
          ? `Howdy,\n\nThanks for contacting the owner of the ${type} you found. They've been notified and will reach out to you at ${reporterEmail} if they need more details.\n\nThanks,\nThe Shelf Team\n\n---\nEmail sent via shelf.nu\n\n`
          : `Howdy,\n\nThanks for contacting the QR code owner. They've been notified and will reach out to you at ${reporterEmail} if they need more details.\n\nThanks,\nThe Shelf Team\n\n---\nEmail sent via shelf.nu\n\n`,
      }),
    ]);
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to send report emails",
      additionalData: { ownerEmail, reporterEmail, item, type, normalizedName },
      label: "Report",
    });
  }
}
