import type { Prisma, User } from "@prisma/client";
import type PgBoss from "pg-boss";
import { db } from "~/database/db.server";
import { sendEmail } from "~/emails/mail.server";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { QueueNames, scheduler } from "~/utils/scheduler.server";
import { assetAlertEmailHtmlString, assetAlertEmailText } from "./emails";
import type { AssetsEventType, AssetsSchedulerData } from "./scheduler.server";
import { createNote } from "../note/service.server";

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

type UserToEmail = Pick<User, "email" | "firstName" | "lastName"> & {
  isOwner?: boolean;
};

const ASSET_SCHEDULER_EVENT_HANDLERS: Record<
  AssetsEventType,
  (job: PgBoss.Job<AssetsSchedulerData>) => Promise<void>
> = {
  REMINDER: async (job) => {
    const reminder = await db.assetReminder.findFirst({
      where: { id: job.data.reminderId },
      include: ASSET_REMINDER_INCLUDES_FOR_EMAIL,
    });

    if (!reminder) {
      Logger.warn(
        new ShelfError({
          cause: null,
          message: "Asset reminder not found for scheduled job. Skipping.",
          additionalData: { ...job.data },
          label: "Asset Scheduler",
          shouldBeCaptured: false,
        })
      );
      return;
    }

    const usersToSendEmail = reminder.teamMembers
      .filter((tm) => !!tm.user)
      .map((teamMember) => teamMember.user! as UserToEmail);

    const hasTeamMemberWithoutUser = reminder.teamMembers.some(
      (tm) => !tm.user
    );

    /**
     * If there is some teamMember without a user associated
     * that means the access has been revoked to that teamMember.
     * Then, in this case we have to send an email to the owner with special note.
     */
    if (hasTeamMemberWithoutUser) {
      const owner = await db.user.findFirst({
        where: {
          userOrganizations: {
            some: {
              organizationId: reminder.organizationId,
              roles: { has: "OWNER" },
            },
          },
        },
        select: { email: true, firstName: true, lastName: true },
      });

      if (!owner) {
        throw new ShelfError({
          cause: null,
          message: "No owner found",
          label: "Asset Scheduler",
        });
      }

      usersToSendEmail.push({
        ...owner,
        isOwner: true,
      });
    }

    /** Sending alert mails to all associated users. */
    await Promise.all([
      ...usersToSendEmail.map(async (user) => {
        const html = await assetAlertEmailHtmlString({
          asset: reminder.asset,
          user,
          reminder,
          workspaceName: reminder.organization.name,
          isOwner: user.isOwner,
        });

        sendEmail({
          subject: "⏰ Asset Reminder Notice - Shelf",
          to: user.email,
          text: assetAlertEmailText({
            asset: reminder.asset,
            user,
            reminder,
            workspaceName: reminder.organization.name,
            isOwner: user.isOwner,
          }),
          html,
        });
      }),
      createNote({
        assetId: reminder.assetId,
        userId: reminder.createdById,
        type: "UPDATE",
        content: `**System** has sent **${reminder.name.trim()}** reminder.`,
      }),
    ]);
  },
};

/**
 * This function is used to register asset workers.
 * Workers are used to process scheduled events.
 */
export async function regierAssetWorkers() {
  await scheduler.work<AssetsSchedulerData>(
    QueueNames.assetsQueue,
    async (job) => {
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
    }
  );
}
