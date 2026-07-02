import type { AssetReminder, Prisma, TeamMember } from "@prisma/client";
import { db } from "~/database/db.server";
import { updateCookieWithPerPage } from "~/utils/cookies.server";
import { isLikeShelfError, isNotFoundError, ShelfError } from "~/utils/error";
import { getCurrentSearchParams } from "~/utils/http.server";
import { getParamsValues } from "~/utils/list";
import { wrapLinkForNote, wrapUserLinkForNote } from "~/utils/markdoc-wrappers";
import { assertAssetsBelongToOrg } from "~/utils/org-validation.server";
import { ASSET_REMINDER_INCLUDE_FIELDS } from "./fields";
import { isRecurringReminder } from "./recurrence";
import {
  ASSETS_EVENT_TYPE_MAP,
  cancelAssetReminderScheduler,
  recurringReminderJobOptions,
  scheduleAssetReminder,
} from "./scheduler.server";
import { createNote } from "../note/service.server";
import { getUserByID } from "../user/service.server";

const label = "Asset Reminder";

/**
 * Cadence payload for a recurring reminder. `null` = one-shot.
 * Callers derive (unit, interval) from the dialog's Repeat preset and capture
 * the timezone from client hints; the tier gate is enforced by the caller for
 * create (assertUserCanUseRecurringReminders) and by editAssetReminder for
 * edit (compare-to-stored, so downgraded orgs can still edit other fields).
 */
export type ReminderRecurrenceInput = {
  unit: NonNullable<AssetReminder["recurrenceUnit"]>;
  interval: number;
  timezone: string | null;
  endsAt: Date | null;
} | null;

export async function createAssetReminder({
  name,
  message,
  alertDateTime,
  assetId,
  createdById,
  organizationId,
  teamMembers,
  recurrence = null,
}: Pick<
  AssetReminder,
  | "name"
  | "message"
  | "alertDateTime"
  | "assetId"
  | "createdById"
  | "organizationId"
> & {
  teamMembers: TeamMember["id"][];
  recurrence?: ReminderRecurrenceInput;
}) {
  try {
    await Promise.all([
      // why: assetId is user-supplied (route param) — prove it belongs to the
      // caller's org BEFORE creating, per org-scope-user-supplied-ids rule
      // (the note write below validates too, but only after the row exists)
      assertAssetsBelongToOrg({ assetIds: [assetId], organizationId }),
      validateTeamMembersForReminder(teamMembers, organizationId),
    ]);

    const user = await getUserByID(createdById, {
      select: {
        id: true,
        firstName: true,
        lastName: true,
        displayName: true,
      } satisfies Prisma.UserSelect,
    });
    const assetReminder = await db.assetReminder.create({
      data: {
        name,
        message,
        alertDateTime,
        assetId,
        createdById,
        organizationId,
        recurrenceUnit: recurrence?.unit ?? null,
        recurrenceInterval: recurrence?.interval ?? null,
        recurrenceTimezone: recurrence?.timezone ?? null,
        recurrenceEndsAt: recurrence?.endsAt ?? null,
        teamMembers: {
          connect: teamMembers.map((id) => ({ id })),
        },
      },
    });

    await Promise.all([
      createNote({
        assetId,
        // why: scope the note's asset to the reminder's org so a caller
        // cannot attach a note to another tenant's asset (cross-org IDOR)
        organizationId,
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
        // why: recurring jobs need retries + singleton dedupe or a transient
        // failure kills the chain; one-shot jobs keep historical semantics
        options: recurrence
          ? recurringReminderJobOptions(assetReminder.id, alertDateTime)
          : {},
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
      shouldBeCaptured: isLikeShelfError(cause) ? cause.shouldBeCaptured : true,
    });
  }
}

async function validateTeamMembersForReminder(
  teamMembers: TeamMember["id"][],
  organizationId: TeamMember["organizationId"]
) {
  const teamMembersWithUserCount = await db.teamMember.count({
    where: {
      id: { in: teamMembers },
      user: { isNot: null },
      organizationId,
    },
  });

  if (teamMembersWithUserCount !== teamMembers.length) {
    // Stale form state: a team member the user selected has since been
    // removed, lost their linked user account, or never belonged to this
    // workspace. This is a 4xx, not a 5xx — surface it without paging.
    throw new ShelfError({
      cause: null,
      label,
      message:
        "One or more selected team members are no longer available. Please refresh the page and pick recipients again.",
      additionalData: {
        requestedTeamMemberCount: teamMembers.length,
        validTeamMemberCount: teamMembersWithUserCount,
      },
      status: 400,
      shouldBeCaptured: false,
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
    const { page, perPageParam, search, orderDirection } =
      getParamsValues(searchParams);
    /**
     * We dont use orderBy from getParamsValues because in our case we need the default value to be alertDateTime whgen orderBy is not present
     */
    const orderBy = searchParams.get("orderBy") || "alertDateTime";

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
        orderBy: [{ [orderBy]: orderDirection }, { createdAt: "desc" }],
      }),
      db.assetReminder.count({ where: finalWhere }),
    ]);

    // why: divide by the cookie-resolved perPage, not the raw query param —
    // perPageParam defaults to 0 without a ?per_page, making this Infinity
    const totalPages = Math.ceil(totalReminders / perPage);

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
  recurrence = null,
  canUseRecurringReminders,
}: Pick<
  AssetReminder,
  "id" | "name" | "message" | "alertDateTime" | "organizationId"
> & {
  teamMembers: TeamMember["id"][];
  recurrence?: ReminderRecurrenceInput;
  /**
   * Whether the org's tier allows recurring reminders. The gate only fires
   * when this edit ADDS or CHANGES recurrence relative to the stored row —
   * downgraded orgs can still edit other fields, turn recurrence off, or
   * delete the reminder.
   */
  canUseRecurringReminders: boolean;
}) {
  try {
    await validateTeamMembersForReminder(teamMembers, organizationId);

    /** This will act as a validation to check if reminder exists */
    const reminder = await db.assetReminder.findFirstOrThrow({
      where: { id, organizationId },
    });

    const now = new Date();
    /**
     * One-shot reminders become immutable after they fire (historical
     * events). A RECURRING reminder stays editable even when its stored
     * alertDateTime is briefly in the past (fire-to-fetch poll window) or
     * the series ended — editing re-arms it with a new future date.
     */
    if (now > reminder.alertDateTime && !isRecurringReminder(reminder)) {
      throw new ShelfError({
        cause: null,
        message: "Edit is not allowed for this reminder.",
        label: "Asset Reminder",
        additionalData: { id },
        shouldBeCaptured: false,
      });
    }

    if (recurrence && !canUseRecurringReminders) {
      const recurrenceChanged =
        reminder.recurrenceUnit !== recurrence.unit ||
        reminder.recurrenceInterval !== recurrence.interval ||
        (reminder.recurrenceEndsAt?.getTime() ?? null) !==
          (recurrence.endsAt?.getTime() ?? null);

      if (!isRecurringReminder(reminder) || recurrenceChanged) {
        throw new ShelfError({
          cause: null,
          title: "Not allowed",
          message:
            "Recurring reminders are not available on your workspace's current plan. Please upgrade your subscription to unlock this feature, or set a one-time reminder instead.",
          label: "Tier",
          additionalData: { id, organizationId },
          shouldBeCaptured: false,
        });
      }
    }

    const updatedReminder = await db.assetReminder.update({
      // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: reminder.id comes from the org-scoped findFirstOrThrow above (where id + organizationId)
      where: { id: reminder.id },
      data: {
        name,
        message,
        alertDateTime,
        recurrenceUnit: recurrence?.unit ?? null,
        recurrenceInterval: recurrence?.interval ?? null,
        recurrenceTimezone: recurrence?.timezone ?? null,
        recurrenceEndsAt: recurrence?.endsAt ?? null,
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
      options: recurrence ? recurringReminderJobOptions(reminder.id, when) : {},
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
      // Forward the inner ShelfError's decision when the cause is already
      // a ShelfError — otherwise this wrapper re-captures intentional 4xx
      // throws like the stale-team-member validator (`shouldBeCaptured:
      // false`) or the "Edit is not allowed" guard above. Fall back to the
      // Prisma not-found check for raw causes.
      shouldBeCaptured: isLikeShelfError(cause)
        ? cause.shouldBeCaptured
        : !isNotFoundError(cause),
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
      // Forward the inner ShelfError's decision when present so this
      // wrapper does not re-capture intentional 4xx throws.
      shouldBeCaptured: isLikeShelfError(cause)
        ? cause.shouldBeCaptured
        : !isNotFoundError(cause),
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
    const reminders = await db.assetReminder.findMany({
      where: {
        organizationId,
        alertDateTime: {
          gte: new Date(),
        },
      },
      take,
      include: ASSET_REMINDER_INCLUDE_FIELDS,
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
      // why: asc = the NEXT two upcoming reminders (desc showed the two
      // furthest-future ones; the home widget already uses asc)
      orderBy: { alertDateTime: "asc" },
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
