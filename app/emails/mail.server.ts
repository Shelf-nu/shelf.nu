import type { Attachment } from "nodemailer/lib/mailer";
import { transporter } from "~/emails/transporter.server";
import { SMTP_FROM } from "../utils/env";
import { ShelfError } from "../utils/error";

export const sendEmail = async ({
  to,
  subject,
  text,
  html,
  attachments,
  from,
  replyTo,
}: {
  /** Email address of recipient */
  to: string;

  /** Subject of email */
  subject: string;

  /** Text content of email */
  text: string;

  /** HTML content of email */
  html?: string;

  attachments?: Attachment[];

  /** Override the default sender */
  from?: string;

  /** Override the default reply to email address */
  replyTo?: string;
}) => {
  try {
    // send mail with defined transport object
    await transporter.sendMail({
      from: from || SMTP_FROM || `"Shelf" <updates@emails.shelf.nu>`, // sender address
      replyTo: replyTo || "support@shelf.nu", // reply to
      to, // list of receivers
      subject, // Subject line
      text, // plain text body
      html: html || "", // html body
      attachments: [...(attachments || [])],
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Unable to send email",
      additionalData: { to, subject, from },
      label: "Email",
    });
  }

  // verify connection configuration
  // transporter.verify(function (error) {
  //   if (error) {
  //     // eslint-disable-next-line no-console
  //     console.log(error);
  //   } else {
  //     // eslint-disable-next-line no-console
  //     console.log("Server is ready to take our messages");
  //   }
  // });

  // Message sent: <b658f8ca-6296-ccf4-8306-87d57a0b4321@example.com>

  // Preview only available when sending through an Ethereal account
  // console.log("Preview URL: %s", nodemailer.getTestMessageUrl(info));
};

/** Utility function to add delay between operations */
async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Process emails in batches with rate limiting
 * @param emails - Array of email configurations to send
 * @param batchSize - Number of emails to process per batch (default: 2)
 * @param delayMs - Milliseconds to wait between batches (default: 1000ms)
 */
export async function sendEmailsWithRateLimit(
  emails: Array<{
    to: string;
    subject: string;
    text: string;
    html: string;
  }>,
  batchSize = 2,
  delayMs = 1100
): Promise<void> {
  for (let i = 0; i < emails.length; i += batchSize) {
    // Process emails in batches of specified size
    const batch = emails.slice(i, i + batchSize);

    // Send emails in current batch concurrently
    await Promise.all(batch.map((email) => sendEmail(email)));

    // If there are more emails to process, add delay before next batch
    if (i + batchSize < emails.length) {
      await delay(delayMs);
    }
  }
}
