import { sbDb } from "~/database/supabase.server";
import { sendEmail } from "~/emails/mail.server";
import type { QR_SELECT_FOR_REPORT } from "~/routes/qr+/_public+/$qrId_.contact-owner";
import { ShelfError } from "~/utils/error";
import { normalizeQrData } from "~/utils/qr";

export async function createReport({
  email,
  content,
  assetId,
  kitId,
}: {
  email: string;
  content: string;
  assetId?: string;
  kitId?: string;
}) {
  try {
    const { data, error } = await sbDb
      .from("ReportFound")
      .insert({
        email,
        content,
        ...(assetId ? { assetId } : {}),
        ...(kitId ? { kitId } : {}),
      })
      .select()
      .single();

    if (error) throw error;
    return data;
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
  ownerEmail: string;
  message: string;
  reporterEmail: string;
  qr: {
    id: string;
    assetId: string | null;
    kitId: string | null;
    asset: { title: string } | null;
    kit: { name: string } | null;
  };
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
