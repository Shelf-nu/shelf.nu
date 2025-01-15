import type { Attachment } from "nodemailer/lib/mailer";
import { config } from "~/config/shelf.config";
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
  const { logoPath } = config;

  try {
    // send mail with defined transport object
    await transporter.sendMail({
      from: from || SMTP_FROM || `"Shelf" <no-reply@emails.shelf.nu>`, // sender address
      ...(replyTo && { replyTo }), // reply to
      to, // list of receivers
      subject, // Subject line
      text, // plain text body
      html: html || "", // html body
      attachments: [
        {
          filename: "logo.png",
          path: logoPath
            ? `${process.env.SERVER_URL}${config.logoPath?.fullLogo}`
            : `${process.env.SERVER_URL}/static/images/shelf-symbol.png`,
          cid: "shelf-logo",
        },
        ...(attachments || []),
      ],
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
