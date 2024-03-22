import type { Asset, ReportFound, User } from "@prisma/client";
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils";
import { sendEmail } from "~/utils/mail.server";

export async function createReport({
  email,
  content,
  assetId,
}: Pick<ReportFound, "email" | "content"> & { assetId: Asset["id"] }) {
  try {
    return await db.reportFound.create({
      data: {
        email,
        content,
        asset: {
          connect: {
            id: assetId,
          },
        },
      },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while creating the report. Please try again or contact support.",
      additionalData: { email, content, assetId },
      label: "Report",
    });
  }
}

export async function sendReportEmails({
  owner,
  message,
  reporterEmail,
  asset,
}: {
  owner: User;
  message: ReportFound["content"];
  reporterEmail: ReportFound["email"];
  asset: Asset | null;
}) {
  try {
    return await Promise.all([
      /** Send email to owner */
      sendEmail({
        to: owner.email,
        subject: "Reported asset",
        text: asset
          ? `Your asset ${asset.title} has been reported found. The reason is: \n\n| ${message} \n\n For contact use this email: ${reporterEmail}\n\nEmail sent via shelf.nu`
          : `Your asset you own has been reported found. The reason is: \n\n| ${message} \n\n For contact use this email: ${reporterEmail}\n\nEmail sent via shelf.nu`,
      }),

      /** Send email to reporter */
      sendEmail({
        to: reporterEmail,
        subject: "Reported asset",
        text: `Thank you for contacting the owner of the asset you found. They have been notified of your message and will contact you if they are interested.\n\nEmail sent via shelf.nu`,
      }),
    ]);
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to send report emails",
      additionalData: { owner, reporterEmail, asset },
      label: "Report",
    });
  }
}
