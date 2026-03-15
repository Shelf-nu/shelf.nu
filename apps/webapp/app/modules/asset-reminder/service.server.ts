import type { AssetReminder, TeamMember } from "@shelf/database";
import { db } from "~/database/db.server";
import {
  count,
  create,
  createMany,
  deleteMany,
  findFirst,
  findFirstOrThrow,
  findMany,
  remove,
  update,
} from "~/database/query-helpers.server";
import { updateCookieWithPerPage } from "~/utils/cookies.server";
import { isLikeShelfError, isNotFoundError, ShelfError } from "~/utils/error";
import { getCurrentSearchParams } from "~/utils/http.server";
import { getParamsValues } from "~/utils/list";
import { wrapLinkForNote, wrapUserLinkForNote } from "~/utils/markdoc-wrappers";
import { ASSET_REMINDER_SELECT_FIELDS } from "./fields";
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
    await validateTeamMembersForReminder(teamMembers, organizationId);

    const user = await getUserByID(createdById, {
      select: "id, firstName, lastName",
    });
    const assetReminder = await create(db, "AssetReminder", {
      name,
      message,
      alertDateTime: new Date(alertDateTime).toISOString(),
      assetId,
      createdById,
      organizationId,
    });

    // Handle team member connections via join table
    if (teamMembers.length > 0) {
      const connections = teamMembers.map((tmId) => ({
        assetReminderId: assetReminder.id,
        teamMemberId: tmId,
      }));
      await createMany(db, "AssetReminderToTeamMember", connections);
    }

    await Promise.all([
      createNote({
        assetId,
        userId: createdById,
        type: "UPDATE",
        content: `${wrapUserLinkForNote({
          id: createdById,
          firstName: user.firstName,
          lastName: user.lastName,
        })} created a new reminder ${wrapLinkForNote(
          `/assets/${assetId}/reminders?${new URLSearchParams({
            s: assetReminder.name,
          }).toString()}`,
          assetReminder.name
        )}.`,
      }),
      scheduleAssetReminder({
        data: {
          reminderId: assetReminder.id,
          eventType: ASSETS_EVENT_TYPE_MAP.REMINDER,
        },
        when: alertDateTime,
      }),
    ]);

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

async function validateTeamMembersForReminder(
  teamMembers: TeamMember["id"][],
  organizationId: TeamMember["organizationId"]
) {
  const teamMembersWithUserCount = await count(db, "TeamMember", {
    id: { in: teamMembers },
    userId: { not: null },
    organizationId,
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
  where?: Record<string, unknown>;
}) {
  try {
    const searchParams = getCurrentSearchParams(request);
    const { page, perPageParam, search, orderDirection } =
      getParamsValues(searchParams);
    /**
     * We dont use orderBy from getParamsValues because in our case we need the default value to be alertDateTime when orderBy is not present
     */
    const orderBy = searchParams.get("orderBy") || "alertDateTime";

    const cookie = await updateCookieWithPerPage(request, perPageParam);
    const { perPage } = cookie;

    const skip = page > 1 ? (page - 1) * perPage : 0;
    const take = perPage >= 1 && perPage <= 100 ? perPage : 20;

    const finalWhere: Record<string, unknown> = {
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
        ],
      }));
    }

    const [reminders, totalReminders] = await Promise.all([
      findMany(db, "AssetReminder", {
        where: finalWhere,
        take,
        skip,
        select: ASSET_REMINDER_SELECT_FIELDS,
        orderBy: [{ [orderBy]: orderDirection }, { createdAt: "desc" }],
      }),
      count(db, "AssetReminder", finalWhere),
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
    await validateTeamMembersForReminder(teamMembers, organizationId);

    /** This will act as a validation to check if reminder exists */
    const reminder = await findFirstOrThrow(db, "AssetReminder", {
      where: { id, organizationId },
    });

    const now = new Date();
    if (now > new Date(reminder.alertDateTime)) {
      throw new ShelfError({
        cause: null,
        message: "Edit is not allowed for this reminder.",
        label: "Asset Reminder",
        additionalData: { id },
        shouldBeCaptured: false,
      });
    }

    const updatedReminder = await update(db, "AssetReminder", {
      where: { id: reminder.id },
      data: {
        name,
        message,
        alertDateTime: new Date(alertDateTime).toISOString(),
      },
    });

    // Handle team member relations via join table:
    // 1. Remove all existing connections
    await deleteMany(db, "AssetReminderToTeamMember", {
      assetReminderId: id,
    });

    // 2. Create new connections
    if (teamMembers.length > 0) {
      const connections = teamMembers.map((tmId) => ({
        assetReminderId: id,
        teamMemberId: tmId,
      }));
      await createMany(db, "AssetReminderToTeamMember", connections);
    }

    /** Reschedule Reminder */
    await cancelAssetReminderScheduler(reminder as unknown as AssetReminder);
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
    let msg = "Something went wrong while editing reminder.";

    if (isNotFoundError(cause)) {
      msg = "Reminder not found or you are viewing in wrong organization.";
    }

    if (isLikeShelfError(cause)) {
      msg = cause.message;
    }

    throw new ShelfError({
      cause,
      message: msg,
      label,
    });
  }
}

export async function deleteAssetReminder({
  id,
  organizationId,
}: Pick<AssetReminder, "id" | "organizationId">) {
  try {
    // First get the reminder data before deleting (needed for scheduler cancellation)
    const reminder = await findFirst(db, "AssetReminder", {
      where: { id, organizationId },
    });

    if (!reminder) {
      throw { code: "PGRST116", message: "No rows found" };
    }

    // Delete join table entries first, then the reminder
    await deleteMany(db, "AssetReminderToTeamMember", {
      assetReminderId: id,
    });
    await remove(db, "AssetReminder", { id, organizationId });

    await cancelAssetReminderScheduler(reminder as unknown as AssetReminder);

    return reminder;
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

export async function getUpcomingRemindersForHomePage({
  organizationId,
  take = 5,
}: {
  organizationId: AssetReminder["organizationId"];
  take?: number;
}) {
  try {
    const reminders = await findMany(db, "AssetReminder", {
      where: {
        organizationId,
        alertDateTime: {
          gte: new Date().toISOString(),
        },
      },
      take,
      select: ASSET_REMINDER_SELECT_FIELDS,
      orderBy: { alertDateTime: "asc" },
    });

    return reminders;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while getting upcoming reminders.",
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
    const reminders = await findMany(db, "AssetReminder", {
      where: {
        assetId,
        organizationId,
        alertDateTime: {
          gte: new Date().toISOString(),
        },
      },
      take: 2,
      select: ASSET_REMINDER_SELECT_FIELDS,
      orderBy: { alertDateTime: "desc" },
    });

    return reminders;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while getting asset reminders.",
      label,
    });
  }
}
