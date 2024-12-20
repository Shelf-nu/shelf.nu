import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";

export const ASSETS_QUEUE_KEY = "assets-queue";

export const ASSETS_EVENT_TYPE_MAP = {
  REMINDER: "REMINDER",
} as const;

export type AssetsEventType =
  (typeof ASSETS_EVENT_TYPE_MAP)[keyof typeof ASSETS_EVENT_TYPE_MAP];

export type AssetsSchedulerData = {
  reminderId: string;
  eventType: AssetsEventType;
};

/**
 * This function is used to schedule an asset reminder.
 */
export async function scheduleAssetReminder({
  data,
  when,
}: {
  data: AssetsSchedulerData;
  when: Date;
}) {
  try {
    const reference = await scheduler.sendAfter(
      ASSETS_QUEUE_KEY,
      data,
      {},
      when
    );

    await db.assetReminder.update({
      where: { id: data.reminderId },
      data: { activeSchedulerReference: reference },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while schedulng asset alert",
      label: "Asset Scheduler",
      additionalData: { ...data, when },
    });
  }
}
