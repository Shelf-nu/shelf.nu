import type { AssetReminder, TeamMember } from "@prisma/client";
import { db } from "~/database/db.server";
import { updateCookieWithPerPage } from "~/utils/cookies.server";
import { isLikeShelfError, isNotFoundError, ShelfError } from "~/utils/error";
import { getCurrentSearchParams } from "~/utils/http.server";
import { getParamsValues } from "~/utils/list";
import { ASSET_REMINDER_INCLUDE_FIELDS } from "./fields";
import {
  ASSETS_EVENT_TYPE_MAP,
  cancelAssetReminderScheduler,
  scheduleAssetReminder,
} from "./scheduler.server";

const label = "Asset Reminder";

export async function createAssetReminder({
  name,
  message,
  alertDateTime,
  assetId,
  createdById,
  organizationId,
  teamMembers,
}: Pick<
  AssetReminder,
  | "name"
  | "message"
  | "alertDateTime"
  | "assetId"
  | "createdById"
  | "organizationId"
> & { teamMembers: TeamMember["id"][] }) {
  try {
    await validateTeamMembersForReminder(teamMembers);

    const assetReminder = await db.assetReminder.create({
      data: {
        name,
        message,
        alertDateTime,
        assetId,
        createdById,
        organizationId,
        teamMembers: {
          connect: teamMembers.map((id) => ({ id })),
        },
      },
    });

    await scheduleAssetReminder({
      data: {
        reminderId: assetReminder.id,
        eventType: ASSETS_EVENT_TYPE_MAP.REMINDER,
      },
      when: alertDateTime,
    });

    return assetReminder;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while creating asset reminder.",
      label,
      additionalData: { assetId, organizationId, createdById },
    });
  }
}

async function validateTeamMembersForReminder(teamMembers: TeamMember["id"][]) {
  const teamMembersWithUserCount = await db.teamMember.count({
    where: {
      id: { in: teamMembers },
      user: { isNot: null },
    },
  });

  if (teamMembersWithUserCount !== teamMembers.length) {
    throw new ShelfError({
      cause: null,
      label,
      message:
        "Something went wrong while validating team members for reminder. Please contact support",
    });
  }
}

export async function getPaginatedAndFilterableReminders({
  assetId,
  organizationId,
  request,
}: Pick<AssetReminder, "assetId" | "organizationId"> & { request: Request }) {
  try {
    const searchParams = getCurrentSearchParams(request);
    const { page, perPageParam } = getParamsValues(searchParams);
    const cookie = await updateCookieWithPerPage(request, perPageParam);
    const { perPage } = cookie;

    const skip = page > 1 ? (page - 1) * perPage : 0;
    const take = perPage >= 1 && perPage <= 100 ? perPage : 20;

    const [reminders, totalReminders] = await Promise.all([
      db.assetReminder.findMany({
        where: { assetId, organizationId },
        take,
        skip,
        include: ASSET_REMINDER_INCLUDE_FIELDS,
      }),
      db.assetReminder.count({
        where: { assetId, organizationId },
      }),
    ]);

    const totalPages = Math.ceil(totalReminders / perPageParam);

    return {
      reminders,
      totalReminders,
      page,
      perPage,
      totalPages,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while getting asset alerts.",
      label,
    });
  }
}

export async function editAssetReminder({
  id,
  name,
  message,
  alertDateTime,
  organizationId,
  teamMembers,
}: Pick<
  AssetReminder,
  "id" | "name" | "message" | "alertDateTime" | "organizationId"
> & { teamMembers: TeamMember["id"][] }) {
  try {
    await validateTeamMembersForReminder(teamMembers);

    /** This will act as a validation to check if reminder exists */
    const reminder = await db.assetReminder.findFirstOrThrow({
      where: { id, organizationId },
    });

    const updatedReminder = await db.assetReminder.update({
      where: { id: reminder.id },
      data: {
        name,
        message,
        alertDateTime,
        teamMembers: {
          set: [], // set empty so that if any team member is removed, the relation is removed
          connect: teamMembers.map((id) => ({ id })), // then connect
        },
      },
    });

    /** Reschedule Reminder */
    await cancelAssetReminderScheduler(reminder);
    const when = new Date(alertDateTime);
    await scheduleAssetReminder({
      data: {
        reminderId: reminder.id,
        eventType: ASSETS_EVENT_TYPE_MAP.REMINDER,
      },
      when,
    });

    return updatedReminder;
  } catch (cause) {
    let message = "Something went wrong while editing reminder.";

    if (isNotFoundError(cause)) {
      message = "Reminder not found or you are viewing in wrong organization.";
    }

    if (isLikeShelfError(cause)) {
      message = cause.message;
    }

    throw new ShelfError({
      cause,
      message,
      label,
    });
  }
}

export async function deleteAssetReminder({
  id,
  organizationId,
}: Pick<AssetReminder, "id" | "organizationId">) {
  try {
    const deletedReminder = await db.assetReminder.delete({
      where: { id, organizationId },
    });

    await cancelAssetReminderScheduler(deletedReminder);

    return deletedReminder;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: isNotFoundError(cause)
        ? "Reminder not found or you are viewing in wrong organization."
        : "Something went wrong while deleting reminder.",
      label,
    });
  }
}

export async function getRemindersForOverviewPage({
  assetId,
  organizationId,
}: {
  assetId: AssetReminder["assetId"];
  organizationId: AssetReminder["organizationId"];
}) {
  try {
    return await db.assetReminder.findMany({
      where: { assetId, organizationId },
      take: 2,
      include: ASSET_REMINDER_INCLUDE_FIELDS,
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while getting asset alerts.",
      label,
    });
  }
}
