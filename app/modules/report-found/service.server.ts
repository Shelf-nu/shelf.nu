import type { Asset, ReportFound, User } from "@prisma/client";
import { db } from "~/database";
import { sendEmail } from "~/utils/mail.server";

export async function createReport({
  email,
  content,
  assetId,
}: Pick<ReportFound, "email" | "content"> & { assetId: Asset["id"] }) {
  return db.reportFound.create({
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
  return await Promise.all([
    /** Send email to owner */
    await sendEmail({
      to: owner.email,
      subject: "Reported asset",
      text: asset
        ? `Your asset ${asset.title} has been reported found. The reason is: \n\n| ${message} \n\n For contact use this email: ${reporterEmail}\n\nEmail sent via shelf.nu`
        : `Your asset you own has been reported found. The reason is: \n\n| ${message} \n\n For contact use this email: ${reporterEmail}\n\nEmail sent via shelf.nu`,
    }),

    /** Send email to reporter */
    await sendEmail({
      to: reporterEmail,
      subject: "Reported asset",
      text: `Thank you for contacting the owner of the asset you found. They have been notified of your message and will contact you if they are interested.\n\nEmail sent via shelf.nu`,
    }),
  ]);
}
