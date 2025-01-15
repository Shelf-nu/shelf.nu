import type { AssetReminder, Prisma, TeamMember } from "@prisma/client";
import { db } from "~/database/db.server";
import { getDateTimeFormat } from "~/utils/client-hints";
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
import { createNote } from "../note/service.server";
import { getUserByID } from "../user/service.server";

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

    const user = await getUserByID(createdById);

    const [assetReminder] = await Promise.all([
      db.assetReminder.create({
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
      }),
      createNote({
        assetId,
        userId: createdById,
        type: "UPDATE",
        content: `**${user.firstName?.trim()} ${user.lastName?.trim()}** has created a new reminder **${name.trim()}**.`,
      }),
    ]);

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
  organizationId,
  request,
  where,
}: Pick<AssetReminder, "organizationId"> & {
  request: Request;
  where?: Prisma.AssetReminderWhereInput;
}) {
  try {
    const searchParams = getCurrentSearchParams(request);
    const { page, perPageParam, search, orderBy, orderDirection } =
      getParamsValues(searchParams);
    const cookie = await updateCookieWithPerPage(request, perPageParam);
    const { perPage } = cookie;

    const skip = page > 1 ? (page - 1) * perPage : 0;
    const take = perPage >= 1 && perPage <= 100 ? perPage : 20;

    const finalWhere: Prisma.AssetReminderWhereInput = {
      organizationId,
      ...where,
    };

    if (search) {
      const searchTerms = search
        .toLowerCase()
        .trim()
        .split(",")
        .map((term) => term.trim())
        .filter(Boolean);

      finalWhere.OR = searchTerms.map((term) => ({
        OR: [
          { name: { contains: term, mode: "insensitive" } },
          { message: { contains: term, mode: "insensitive" } },
          {
            teamMembers: {
              some: {
                user: {
                  OR: [
                    {
                      firstName: {
                        contains: term,
                        mode: "insensitive",
                      },
                    },
                    {
                      lastName: {
                        contains: term,
                        mode: "insensitive",
                      },
                    },
                  ],
                },
              },
            },
          },
          {
            asset: { title: { contains: term, mode: "insensitive" } },
          },
        ],
      }));
    }

    const [reminders, totalReminders] = await Promise.all([
      db.assetReminder.findMany({
        where: finalWhere,
        take,
        skip,
        include: ASSET_REMINDER_INCLUDE_FIELDS,
        orderBy: { [orderBy ?? "alertDateTime"]: orderDirection ?? "desc" },
      }),
      db.assetReminder.count({ where: finalWhere }),
    ]);

    const totalPages = Math.ceil(totalReminders / perPageParam);

    return {
      reminders,
      totalReminders,
      page,
      perPage,
      totalPages,
      search,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while getting asset reminders.",
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

    const now = new Date();
    if (now > reminder.alertDateTime) {
      throw new ShelfError({
        cause: null,
        message: "Edit is not allowed for this reminder.",
        label: "Asset Reminder",
        additionalData: { id },
        shouldBeCaptured: false,
      });
    }

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
  request,
}: {
  assetId: AssetReminder["assetId"];
  organizationId: AssetReminder["organizationId"];
  request: Request;
}) {
  try {
    const reminders = await db.assetReminder.findMany({
      where: {
        assetId,
        organizationId,
        alertDateTime: {
          gte: new Date(),
        },
      },
      take: 2,
      include: ASSET_REMINDER_INCLUDE_FIELDS,
      orderBy: { alertDateTime: "desc" },
    });

    return reminders.map((reminder) => ({
      ...reminder,
      displayDate: getDateTimeFormat(request, {
        dateStyle: "short",
        timeStyle: "short",
      }).format(reminder.alertDateTime),
    }));
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while getting asset reminders.",
      label,
    });
  }
}
