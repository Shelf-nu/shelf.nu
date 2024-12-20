import type { Prisma } from "@prisma/client";
import type PgBoss from "pg-boss";
import invariant from "tiny-invariant";
import { db } from "~/database/db.server";
import { sendEmail } from "~/emails/mail.server";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { assetAlertEmailHtmlString, assetAlertEmailText } from "./emails";
import { ASSETS_QUEUE_KEY } from "./scheduler.server";
import type { AssetsEventType, AssetsSchedulerData } from "./scheduler.server";

const ASSET_REMINDER_INCLUDES_FOR_EMAIL = {
  teamMembers: {
    select: {
      user: {
        select: {
          email: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  },
  asset: {
    select: {
      id: true,
      title: true,
      mainImage: true,
      mainImageExpiration: true,
    },
  },
  organization: { select: { name: true } },
} satisfies Prisma.AssetReminderInclude;

const ASSET_SCHEDULER_EVENT_HANDLERS: Record<
  AssetsEventType,
  (job: PgBoss.Job<AssetsSchedulerData>) => Promise<void>
> = {
  REMINDER: async (job) => {
    const reminder = await db.assetReminder
      .findFirstOrThrow({
        where: { id: job.data.reminderId },
        include: ASSET_REMINDER_INCLUDES_FOR_EMAIL,
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message: "Asset reminder not found",
          additionalData: { ...job.data },
          label: "Asset Scheduler",
        });
      });

    const usersToSendEmail = reminder.teamMembers.map((teamMember) => {
      invariant(teamMember.user, "User is not associated with teamMember.");
      return teamMember.user;
    });

    /** Sending alert mails to all associated users. */
    await Promise.all(
      usersToSendEmail.map((user) =>
        sendEmail({
          subject: "Asset Reminder Notice - Shelf",
          to: user.email,
          text: assetAlertEmailText({
            asset: reminder.asset,
            user,
            reminder,
            workspaceName: reminder.organization.name,
          }),
          html: assetAlertEmailHtmlString({
            asset: reminder.asset,
            user,
            reminder,
            workspaceName: reminder.organization.name,
          }),
        })
      )
    );
  },
};

/**
 * This function is used to register asset workers.
 * Workers are used to process scheduled events.
 */
export async function regierAssetWorkers() {
  await scheduler.work<AssetsSchedulerData>(ASSETS_QUEUE_KEY, async (job) => {
    const handler = ASSET_SCHEDULER_EVENT_HANDLERS[job.data.eventType];

    try {
      await handler(job);
    } catch (cause) {
      Logger.error(
        new ShelfError({
          cause,
          message: "Something went wrong while executing scheduled work.",
          additionalData: { data: job.data, work: job.data.eventType },
          label: "Asset Scheduler",
        })
      );
    }
  });
}
