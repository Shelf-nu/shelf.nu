import type { AssetReminder, Prisma, TeamMember } from "@prisma/client";
import { db } from "~/database/db.server";
import { updateCookieWithPerPage } from "~/utils/cookies.server";
import { isLikeShelfError, isNotFoundError, ShelfError } from "~/utils/error";
import { getCurrentSearchParams } from "~/utils/http.server";
import { getParamsValues } from "~/utils/list";
import { wrapLinkForNote, wrapUserLinkForNote } from "~/utils/markdoc-wrappers";
import { assertAssetsBelongToOrg } from "~/utils/org-validation.server";
import { ASSET_REMINDER_INCLUDE_FIELDS } from "./fields";
import { isRecurringReminder, rebaseEndOfDayToZone } from "./recurrence";
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
/**
 * Cadence payload for a recurring reminder. `null` = one-shot.
 * Callers derive (unit, interval) from the dialog's Repeat preset and pass the
 * acting user's resolved timezone; the tier gate is enforced by the caller for
 * create (assertUserCanUseRecurringReminders) and by editAssetReminder for
 * edit (compare-to-stored, so downgraded orgs can still edit other fields).
 */
export type ReminderRecurrenceInput = {
  unit: NonNullable<AssetReminder["recurrenceUnit"]>;
  interval: number;
  timezone: string | null;
  endsAt: Date | null;
} | null;

/**
 * Creates a reminder (optionally recurring) on an asset and schedules its email.
 *
 * The asset must belong to `organizationId`: the reminder is listed in, and
 * emailed to, that workspace, and the email shows the asset's title and image.
 * The ownership check, the reminder and its activity note commit in one
 * transaction, so a refused request (asset or recipient outside the workspace)
 * writes nothing. The email is scheduled only after that commit, so no job is
 * ever queued for a rolled-back reminder. Scheduling itself is not
 * transactional: if it fails, the reminder and note remain and this throws.
 * Recurring jobs are sent with retry + singleton options so a transient
 * failure cannot kill the chain.
 *
 * @param args.assetId - Asset the reminder is about; must be in `organizationId`
 * @param args.organizationId - The caller's validated workspace
 * @param args.teamMembers - Recipients; must be linked users of the same workspace
 * @param args.recurrence - Cadence for a recurring reminder, `null` for one-shot.
 *        The tier gate is asserted by the calling action
 *        (assertUserCanUseRecurringReminders).
 * @returns The created reminder
 * @throws {ShelfError} 400 when the asset is not in the workspace or a recipient is no longer available
 */
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
    await validateTeamMembersForReminder(teamMembers, organizationId);

    const user = await getUserByID(createdById, {
      select: {
        id: true,
        firstName: true,
        lastName: true,
        displayName: true,
      } satisfies Prisma.UserSelect,
    });

    const assetReminder = await db.$transaction(async (tx) => {
      await assertAssetsBelongToOrg(
        { assetIds: [assetId], organizationId },
        tx
      );

      const reminder = await tx.assetReminder.create({
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

      await createNote(
        {
          assetId,
          organizationId,
          userId: createdById,
          type: "UPDATE",
          content: `${wrapUserLinkForNote({
            ...user,
            id: createdById,
          })} created a new reminder ${wrapLinkForNote(
            `/assets/${assetId}/reminders?${new URLSearchParams({
              s: reminder.name,
            }).toString()}`,
            reminder.name
          )}.`,
        },
        tx
      );

      return reminder;
    });

    await scheduleAssetReminder({
      data: {
        reminderId: assetReminder.id,
        eventType: ASSETS_EVENT_TYPE_MAP.REMINDER,
      },
      when: alertDateTime,
      // why: recurring jobs need retries + singleton dedupe or a transient
      // failure kills the chain; one-shot jobs keep their plain options
      options: recurrence
        ? recurringReminderJobOptions(assetReminder.id, alertDateTime)
        : {},
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

    // Divide by the page size the query used. The raw `per_page` param is 0
    // whenever the URL carries none.
    const totalPages = Math.ceil(totalReminders / take);

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

/**
 * Edits a reminder, including its recurrence configuration.
 *
 * Recurrence timezone semantics: the series' timezone is captured when
 * recurrence is FIRST enabled and preserved on subsequent edits, even when
 * the editor is in another timezone. Otherwise a plain edit (message/
 * recipients) from another zone would silently re-anchor the series'
 * wall-clock schedule and shift future occurrences across DST boundaries.
 * The submitted end date's CALENDAR day is re-anchored (end-of-day) into
 * the stored zone for the same reason.
 *
 * @returns The updated AssetReminder.
 * @throws {ShelfError} 400 stale recipients; not-found for wrong org;
 *         "Edit is not allowed" for fired one-shots; 403 when the edit adds
 *         or changes recurrence and the tier lacks the capability.
 */
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

    /**
     * Preserve the series' stored timezone once recurrence exists (see the
     * function JSDoc), re-anchoring the submitted end date's calendar day
     * into that zone. Because the timezone is never taken from the request
     * for an existing series, a downgraded org cannot mutate the schedule
     * via the zone either.
     */
    const effectiveRecurrence =
      recurrence && isRecurringReminder(reminder)
        ? {
            ...recurrence,
            timezone: reminder.recurrenceTimezone,
            endsAt: recurrence.endsAt
              ? rebaseEndOfDayToZone(
                  recurrence.endsAt,
                  recurrence.timezone,
                  reminder.recurrenceTimezone
                )
              : null,
          }
        : recurrence;

    if (effectiveRecurrence && !canUseRecurringReminders) {
      const recurrenceChanged =
        reminder.recurrenceUnit !== effectiveRecurrence.unit ||
        reminder.recurrenceInterval !== effectiveRecurrence.interval ||
        (reminder.recurrenceEndsAt?.getTime() ?? null) !==
          (effectiveRecurrence.endsAt?.getTime() ?? null) ||
        // why: moving the next fire date re-anchors the whole series — that
        // is recurring behavior too, so it's gated. Message/recipient edits
        // round-trip the prefilled date unchanged and still pass.
        reminder.alertDateTime.getTime() !== alertDateTime.getTime();

      if (!isRecurringReminder(reminder) || recurrenceChanged) {
        throw new ShelfError({
          cause: null,
          title: "Not allowed",
          message:
            "Recurring reminders are not available on your workspace's current plan. Please upgrade your subscription to unlock this feature, or set a one-time reminder instead.",
          label: "Tier",
          additionalData: { id, organizationId },
          status: 403,
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
        recurrenceUnit: effectiveRecurrence?.unit ?? null,
        recurrenceInterval: effectiveRecurrence?.interval ?? null,
        recurrenceTimezone: effectiveRecurrence?.timezone ?? null,
        recurrenceEndsAt: effectiveRecurrence?.endsAt ?? null,
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
      options: effectiveRecurrence
        ? recurringReminderJobOptions(reminder.id, when)
        : {},
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
        // A reminder on an archived asset will not fire, so it is not
        // upcoming. It stays listed, marked, on /reminders.
        asset: { archivedAt: null },
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
