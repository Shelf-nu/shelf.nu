import { Logger } from "~/utils/logger";
import { QueueNames, scheduler } from "~/utils/scheduler.server";
import { triggerEmail } from "./email.worker.server";
import type { EmailPayloadType } from "./types";

export const sendEmail = (payload: EmailPayloadType) => {
  // attempt to send email, push to the queue if it fails
  triggerEmail(payload).catch((err) => {
    Logger.warn({
      err,
      details: {
        to: payload.to,
        subject: payload.subject,
        from: payload.from,
      },
      message: "email sending failed, pushing to the queue",
    });
    void addToQueue(payload);
  });
};

const addToQueue = async (payload: EmailPayloadType) => {
  try {
    await scheduler.send(QueueNames.emailQueue, payload, {
      retryLimit: 5,
      retryDelay: 5,
    });
  } catch (err) {
    Logger.warn({
      err,
      details: {
        to: payload.to,
        subject: payload.subject,
        from: payload.from,
      },
      message: "Failed to push email payload to queue",
    });
  }
};
