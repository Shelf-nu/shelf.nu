import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { QueueNames, scheduler } from "~/utils/scheduler.server";
import { triggerEmail } from "./email.worker.server";
import type { EmailPayloadType } from "./types";

const label = "Email";
export const sendEmail = (payload: EmailPayloadType) => {
  // attempt to send email, push to the queue if it fails
  triggerEmail(payload).catch((cause) => {
    Logger.error(
      new ShelfError({
        cause,
        additionalData: {
          payload,
          queueName: QueueNames.emailQueue,
          action: "sendEmail",
        },
        message: "email sending failed, pushing to the queue",
        label,
      })
    );
    void addToQueue(payload);
  });
};

const addToQueue = async (payload: EmailPayloadType) => {
  const options = {
    retryLimit: 15,
    retryDelay: 60,
    expireInHours: 24,
  };

  try {
    await scheduler.send(QueueNames.emailQueue, payload, options);
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        additionalData: {
          payload,
          options,
          queueName: QueueNames.emailQueue,
          action: "addToQueue",
        },
        message: "Failed to push email payload to queue",
        label,
      })
    );
  }
};
