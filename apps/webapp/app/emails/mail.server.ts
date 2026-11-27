import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { QueueNames, scheduler } from "~/utils/scheduler.server";
import { triggerEmail } from "./email.worker.server";
import { redactEmailPayloadForLog } from "./redact-email-payload";
import type { EmailPayloadType } from "./types";

const label = "Email";
/**
 * Sends an email directly and falls back to the retrying queue when the
 * direct send fails. Resolves once the send or the enqueue has finished, for
 * callers that must not move on before delivery is settled. Never rejects:
 * both failures are logged here.
 *
 * @returns true when the email was sent or queued for retry, false when both
 *   the direct send and the enqueue failed
 */
export const sendEmailAndWait = (payload: EmailPayloadType): Promise<boolean> =>
  // attempt to send email, push to the queue if it fails
  triggerEmail(payload)
    .then(() => true)
    .catch(async (cause) => {
      Logger.error(
        new ShelfError({
          cause,
          additionalData: {
            payload: redactEmailPayloadForLog(payload),
            queueName: QueueNames.emailQueue,
            action: "sendEmail",
          },
          message: "email sending failed, pushing to the queue",
          label,
          shouldBeCaptured: false, // Will be captured if all queue retries fail
        })
      );
      return addToQueue(payload);
    });

/** Fire-and-forget form of {@link sendEmailAndWait}, for the common case. */
export const sendEmail = (payload: EmailPayloadType) => {
  void sendEmailAndWait(payload);
};

/** Queues the email for retried delivery. Resolves false when the enqueue fails. */
const addToQueue = async (payload: EmailPayloadType): Promise<boolean> => {
  const options = {
    retryLimit: 15,
    retryDelay: 60,
    expireInHours: 24,
  };

  try {
    await scheduler.send(QueueNames.emailQueue, payload, options);
    return true;
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        additionalData: {
          payload: redactEmailPayloadForLog(payload),
          options,
          queueName: QueueNames.emailQueue,
          action: "addToQueue",
        },
        message: "Failed to push email payload to queue",
        label,
      })
    );
    return false;
  }
};
