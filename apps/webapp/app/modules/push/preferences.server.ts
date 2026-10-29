/**
 * Notification preferences
 *
 * Reads and writes a person's push switches (`NotificationPreference`) and
 * applies them to a recipient list at send time. A missing row means every
 * switch is on, so reads fall back to the defaults instead of creating rows.
 * The switches silence push only; email is unaffected.
 *
 * @see {@link file://./types.ts} the switch names and defaults
 * @see {@link file://./service.server.ts} the send pipeline that filters by them
 */
import type { Prisma } from "@prisma/client";
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import type { NotificationPreferences, PushCategory } from "./types";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "./types";

const PREFERENCE_SELECT = {
  pushEnabled: true,
  bookings: true,
  audits: true,
  stockAndReminders: true,
} satisfies Prisma.NotificationPreferenceSelect;

/**
 * Returns a person's push switches, or the all-on defaults when they have
 * never changed one.
 *
 * @param userId - The person whose switches to read
 * @returns Their switches
 * @throws {ShelfError} If the database read fails
 */
export async function getNotificationPreferences(
  userId: string
): Promise<NotificationPreferences> {
  try {
    const row = await db.notificationPreference.findUnique({
      where: { userId },
      select: PREFERENCE_SELECT,
    });
    return row ?? { ...DEFAULT_NOTIFICATION_PREFERENCES };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while loading your notification settings.",
      additionalData: { userId },
      label: "Push",
    });
  }
}

/**
 * Sets some of a person's push switches and leaves the rest as they were.
 * Safe to repeat: the same changes always produce the same row.
 *
 * @param userId - The person whose switches to change
 * @param changes - The switches to set
 * @returns All of their switches after the change
 * @throws {ShelfError} If the database write fails
 */
export async function updateNotificationPreferences(
  userId: string,
  changes: Partial<NotificationPreferences>
): Promise<NotificationPreferences> {
  try {
    return await db.notificationPreference.upsert({
      where: { userId },
      create: { userId, ...changes },
      update: changes,
      select: PREFERENCE_SELECT,
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while saving your notification settings.",
      additionalData: { userId, changes },
      label: "Push",
    });
  }
}

/**
 * Keeps the recipients who still want a push of this category: those whose
 * master switch and category switch are both on, or who never changed them.
 *
 * @param args.userIds - The intended recipients
 * @param args.category - The category of the push
 * @returns The recipients to send to, in their original order
 */
export async function filterRecipientsByPreference({
  userIds,
  category,
}: {
  userIds: string[];
  category: PushCategory;
}): Promise<string[]> {
  const rows = await db.notificationPreference.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, ...PREFERENCE_SELECT },
  });
  const switchedOff = new Set(
    rows
      .filter((row) => !row.pushEnabled || !row[category])
      .map((row) => row.userId)
  );
  return userIds.filter((userId) => !switchedOff.has(userId));
}
