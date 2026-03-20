import { ShelfError } from "~/utils/error";
import { QueueNames, scheduler } from "~/utils/scheduler.server";

export type AddonTrialSchedulerData = {
  addonType: "audits" | "barcodes";
  userId: string;
  email: string;
  firstName: string | null;
  customerId: string;
  subscriptionId: string;
  trialEndDate: string; // ISO string for JSON serialization
};

/**
 * Schedules a "trial ends tomorrow" email to be sent at the specified time.
 */
export async function scheduleTrialEndsTomorrowEmail({
  data,
  when,
}: {
  data: AddonTrialSchedulerData;
  when: Date;
}) {
  try {
    await scheduler.sendAfter(QueueNames.addonTrialQueue, data, {}, when);
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while scheduling addon trial ends tomorrow email",
      label: "Stripe",
      additionalData: { ...data, when },
    });
  }
}
