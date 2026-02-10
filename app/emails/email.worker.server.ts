import { transporter } from "~/emails/transporter.server";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { QueueNames, scheduler } from "~/utils/scheduler.server";
import type { EmailPayloadType } from "./types";
import { SMTP_FROM, SUPPORT_EMAIL } from "../utils/env";

// every node will execute 5 jobs(teamSize) every 3 minutes(newJobCheckIntervalSeconds),
// increase teamSize if you need better concurrency
// but keep email provider rate limiting and a potential n/w throughput load on postgress in mind
// teamSize of 20-25 is a good limit if we need to scale email throughput in the future
export const registerEmailWorkers = async () => {
  await scheduler.work<EmailPayloadType>(
    QueueNames.emailQueue,
    { newJobCheckIntervalSeconds: 60 * 3, teamSize: 5, includeMetadata: true },
    async (job) => {
      try {
        await triggerEmail(job.data);
      } catch (cause) {
        const isLastRetry =
          job.retrycount != null &&
          job.retrylimit != null &&
          job.retrycount >= job.retrylimit - 1;

        if (isLastRetry) {
          Logger.error(
            new ShelfError({
              cause,
              message: "Email permanently failed after exhausting all retries",
              additionalData: {
                payload: job.data,
                retryCount: job.retrycount,
                retryLimit: job.retrylimit,
              },
              label: "Email",
            })
          );
        }

        throw cause;
      }
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
      from: from || SMTP_FROM || `"Shelf" <hello@example.com>`, // sender address
      replyTo: replyTo || SUPPORT_EMAIL, // reply to
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
