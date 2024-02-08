import nodemailer from "nodemailer";
import type { Attachment } from "nodemailer/lib/mailer";
import { NODE_ENV, SMTP_HOST, SMTP_PWD, SMTP_USER } from ".";
import logoImg from "../../public/static/images/shelf-symbol.png";

export const sendEmail = async ({
  to,
  subject,
  text,
  html,
  attachments,
  from,
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
}) => {
  // Generate test SMTP service account from ethereal.email

  // create reusable transporter object using the default SMTP transport
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: 465,
    secure: true, // true for 465, false for other ports
    auth: {
      user: SMTP_USER,
      pass: SMTP_PWD,
    },
    logger: NODE_ENV === "development",
    debug: NODE_ENV === "development",
    tls: {
      // do not fail on invalid certs
      rejectUnauthorized: true,
    },
  });

  // send mail with defined transport object
  await transporter.sendMail({
    from: from || `"Shelf" <no-reply@shelf.nu>`, // sender address
    to, // list of receivers
    subject, // Subject line
    text, // plain text body
    html: html || "", // html body
    attachments: [
      {
        filename: "shelf-symbol.png",
        path: `${process.env.SERVER_URL}${logoImg}`,
        cid: "shelf-logo",
      },
      ...(attachments || []),
    ],
  });

  // Message sent: <b658f8ca-6296-ccf4-8306-87d57a0b4321@example.com>

  // Preview only available when sending through an Ethereal account
  // console.log("Preview URL: %s", nodemailer.getTestMessageUrl(info));
};
