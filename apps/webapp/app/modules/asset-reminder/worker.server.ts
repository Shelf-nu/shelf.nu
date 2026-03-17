import type PgBoss from "pg-boss";
import { sbDb } from "~/database/supabase.server";
import { sendEmail } from "~/emails/mail.server";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { QueueNames, scheduler } from "~/utils/scheduler.server";
import { assetAlertEmailHtmlString, assetAlertEmailText } from "./emails";
import {
  ASSET_REMINDER_SELECT_FOR_EMAIL,
  flattenReminderTeamMembers,
  type AssetReminderForEmail,
  type RawAssetReminderForEmail,
} from "./fields";
import type { AssetsEventType, AssetsSchedulerData } from "./scheduler.server";
import { createNote } from "../note/service.server";

type UserToEmail = {
  email: string;
  firstName: string | null;
  lastName: string | null;
  isOwner?: boolean;
};

const ASSET_SCHEDULER_EVENT_HANDLERS: Record<
  AssetsEventType,
  (job: PgBoss.Job<AssetsSchedulerData>) => Promise<void>
> = {
  REMINDER: async (job) => {
    const { data: rawReminder, error: findError } = await sbDb
      .from("AssetReminder")
      .select(ASSET_REMINDER_SELECT_FOR_EMAIL)
      .eq("id", job.data.reminderId)
      .maybeSingle();

    if (findError) throw findError;

    if (!rawReminder) {
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

    const reminder = flattenReminderTeamMembers(
      rawReminder as unknown as RawAssetReminderForEmail
    ) as AssetReminderForEmail;

    const usersToSendEmail: UserToEmail[] = reminder.teamMembers
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
      const { data: owner, error: ownerError } = await sbDb
        .from("UserOrganization")
        .select("user:User!inner(email, firstName, lastName)")
        .eq("organizationId", reminder.organizationId)
        .contains("roles", ["OWNER"])
        .limit(1)
        .single();

      if (ownerError || !owner) {
        throw (
          ownerError ||
          new ShelfError({
            cause: null,
            message: "No owner found",
            label: "Asset Scheduler",
          })
        );
      }

      const ownerUser = owner.user as unknown as {
        email: string;
        firstName: string | null;
        lastName: string | null;
      };
      usersToSendEmail.push({
        ...ownerUser,
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
          customEmailFooter: reminder.organization.customEmailFooter,
        });

        sendEmail({
          subject: "\u23F0 Asset Reminder Notice - Shelf",
          to: user.email,
          text: assetAlertEmailText({
            asset: reminder.asset,
            user,
            reminder,
            workspaceName: reminder.organization.name,
            isOwner: user.isOwner,
            customEmailFooter: reminder.organization.customEmailFooter,
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
