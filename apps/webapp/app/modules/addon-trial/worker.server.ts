import type PgBoss from "pg-boss";
import { sendAuditTrialEndsTomorrowEmail } from "~/emails/stripe/audit-trial-ends-tomorrow";
import { sendBarcodeTrialEndsTomorrowEmail } from "~/emails/stripe/barcode-trial-ends-tomorrow";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { QueueNames, scheduler } from "~/utils/scheduler.server";
import { customerHasPaymentMethod, stripe } from "~/utils/stripe.server";
import type { AddonTrialSchedulerData } from "./scheduler.server";

async function handleAddonTrialJob(
  job: PgBoss.Job<AddonTrialSchedulerData>
): Promise<void> {
  const {
    addonType,
    userId,
    email,
    firstName,
    customerId,
    subscriptionId,
    trialEndDate,
  } = job.data;

  /**
   * Re-check if the customer still has a payment method.
   * They may have removed it since the email was scheduled.
   */
  const hasPaymentMethod = await customerHasPaymentMethod(customerId);
  if (!hasPaymentMethod) {
    Logger.info(
      `Skipping trial ends tomorrow email for user ${userId} - no payment method found`
    );
    return;
  }

  /**
   * Check if the specific subscription is still in trialing status.
   * If the subscription was cancelled or otherwise changed, skip the email.
   */
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  if (subscription.status !== "trialing") {
    Logger.info(
      `Skipping trial ends tomorrow email for user ${userId} - subscription ${subscriptionId} status is "${subscription.status}", not "trialing"`
    );
    return;
  }

  const trialEndDateObj = new Date(trialEndDate);

  if (addonType === "audits") {
    await sendAuditTrialEndsTomorrowEmail({
      firstName,
      email,
      hasPaymentMethod,
      trialEndDate: trialEndDateObj,
    });
  } else {
    await sendBarcodeTrialEndsTomorrowEmail({
      firstName,
      email,
      hasPaymentMethod,
      trialEndDate: trialEndDateObj,
    });
  }
}

/**
 * Registers the addon trial worker to process scheduled
 * "trial ends tomorrow" email jobs.
 */
export async function registerAddonTrialWorkers() {
  await scheduler.work<AddonTrialSchedulerData>(
    QueueNames.addonTrialQueue,
    { teamSize: 1, teamConcurrency: 1 },
    async (job) => {
      try {
        await handleAddonTrialJob(job);
      } catch (cause) {
        Logger.error(
          new ShelfError({
            cause,
            message:
              "Something went wrong while processing addon trial scheduled job.",
            additionalData: {
              data: job.data,
              addonType: job.data.addonType,
            },
            label: "Stripe",
          })
        );
      }
    }
  );
}
