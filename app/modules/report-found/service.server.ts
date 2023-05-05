import type { Item, ReportFound, User } from "@prisma/client";
import { db } from "~/database";
import { sendEmail } from "~/utils/mail.server";

export async function createReport({
  email,
  content,
  itemId,
}: Pick<ReportFound, "email" | "content"> & { itemId: Item["id"] }) {
  return db.reportFound.create({
    data: {
      email,
      content,
      item: {
        connect: {
          id: itemId,
        },
      },
    },
  });
}

export async function sendReportEmails({
  owner,
  message,
  reporterEmail,
  item,
}: {
  owner: User;
  message: ReportFound["content"];
  reporterEmail: ReportFound["email"];
  item: Item | null;
}) {
  /** Send email to owner */
  sendEmail({
    to: owner.email,
    subject: "Reported asset",
    text: item
      ? `Your asset ${item.title} has been reported found. The reason is: \n\n| ${message} \n\n For contact use this email: ${reporterEmail}\n\nEmail sent via shelf.nu`
      : `Your asset you own has been reported found. The reason is: \n\n| ${message} \n\n For contact use this email: ${reporterEmail}\n\nEmail sent via shelf.nu`,
  });

  /** Send email to reporter */
  sendEmail({
    to: reporterEmail,
    subject: "Reported item",
    text: `Thank you for contacting the owner of the asset you found. They have been notified of your message and will contact you if they are interested.\n\nEmail sent via shelf.nu`,
  });
}
