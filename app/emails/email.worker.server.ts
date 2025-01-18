import { transporter } from "~/emails/transporter.server";
import { QueueNames, scheduler } from "~/utils/scheduler.server";
import type { EmailPayloadType } from "./types";
import { SMTP_FROM } from "../utils/env";
import { ShelfError } from "../utils/error";

export const registerEmailWorkers = async () => {
  await scheduler.work<EmailPayloadType>(
    QueueNames.emailQueue,
    { newJobCheckIntervalSeconds: 60 * 3, teamSize: 2 },
    async (job) => {
      await triggerEmail(job.data);
    }
  );
};

export const triggerEmail = async ({
  to,
  subject,
  text,
  html,
  from,
  replyTo,
}: EmailPayloadType) => {
  try {
    // send mail with defined transport object
    await transporter.sendMail({
      from: from || SMTP_FROM || `"Shelf" <updates@emails.shelf.nu>`, // sender address
      replyTo: replyTo || "support@shelf.nu", // reply to
      to, // list of receivers
      subject, // Subject line
      text, // plain text body
      html: html || "", // html body
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
