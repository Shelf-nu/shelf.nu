import type { Sb } from "@shelf/database";
import { sbDb } from "~/database/supabase.server";
import { updateCookieWithPerPage } from "~/utils/cookies.server";
import { isLikeShelfError, isNotFoundError, ShelfError } from "~/utils/error";
import { getCurrentSearchParams } from "~/utils/http.server";
import { getParamsValues } from "~/utils/list";
import { wrapLinkForNote, wrapUserLinkForNote } from "~/utils/markdoc-wrappers";
import {
  ASSET_REMINDER_SELECT_WITH_RELATIONS,
  flattenReminderTeamMembers,
  type RawAssetReminderWithRelations,
} from "./fields";
import {
  ASSETS_EVENT_TYPE_MAP,
  cancelAssetReminderScheduler,
  scheduleAssetReminder,
} from "./scheduler.server";
import { createNote } from "../note/service.server";

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
  Sb.AssetReminderRow,
  "name" | "message" | "assetId" | "createdById" | "organizationId"
> & { alertDateTime: string | Date; teamMembers: string[] }) {
  try {
    await validateTeamMembersForReminder(teamMembers, organizationId);

    const { data: user, error: userError } = await sbDb
      .from("User")
      .select("id, firstName, lastName")
      .eq("id", createdById)
      .single();

    if (userError) throw userError;

    /** Insert the reminder row */
    const alertDateTimeStr =
      typeof alertDateTime === "string"
        ? alertDateTime
        : alertDateTime.toISOString();

    const { data: assetReminder, error: insertError } = await sbDb
      .from("AssetReminder")
      .insert({
        name,
        message,
        alertDateTime: alertDateTimeStr,
        assetId,
        createdById,
        organizationId,
      })
      .select()
      .single();

    if (insertError) throw insertError;

    /** Connect team members via the join table */
    const joinRows = teamMembers.map((tmId) => ({
      A: assetReminder.id,
      B: tmId,
    }));
    const { error: joinError } = await sbDb
      .from("_AssetReminderToTeamMember")
      .insert(joinRows);

    if (joinError) throw joinError;

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
        when: new Date(alertDateTime),
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
  teamMembers: string[],
  organizationId: string
) {
  const { count: teamMembersWithUserCount, error: countError } = await sbDb
    .from("TeamMember")
    .select("*", { count: "exact", head: true })
    .in("id", teamMembers)
    .not("userId", "is", null)
    .eq("organizationId", organizationId);

  if (countError) throw countError;

  if ((teamMembersWithUserCount ?? 0) !== teamMembers.length) {
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
  assetId,
}: {
  organizationId: string;
  request: Request;
  assetId?: string;
}) {
  try {
    const searchParams = getCurrentSearchParams(request);
    const { page, perPageParam, search, orderDirection } =
      getParamsValues(searchParams);
    /**
     * We dont use orderBy from getParamsValues because in our case
     * we need the default value to be alertDateTime when orderBy is not present
     */
    const orderBy = searchParams.get("orderBy") || "alertDateTime";

    const cookie = await updateCookieWithPerPage(request, perPageParam);
    const { perPage } = cookie;

    const skip = page > 1 ? (page - 1) * perPage : 0;
    const take = perPage >= 1 && perPage <= 100 ? perPage : 20;

    let query = sbDb
      .from("AssetReminder")
      .select(ASSET_REMINDER_SELECT_WITH_RELATIONS, { count: "exact" })
      .eq("organizationId", organizationId);

    if (assetId) {
      query = query.eq("assetId", assetId);
    }

    if (search) {
      const searchTerms = search
        .toLowerCase()
        .trim()
        .split(",")
        .map((term) => term.trim())
        .filter(Boolean);

      /**
       * Build an OR filter for name and message fields.
       * Supabase PostgREST doesn't natively support deep relation-based
       * filtering (e.g. teamMembers.user.firstName) in .or(), so we
       * filter on direct columns here. Relation-based search for team
       * member names would require an RPC or view.
       */
      const orClauses = searchTerms.flatMap((term) => [
        `name.ilike.%${term}%`,
        `message.ilike.%${term}%`,
      ]);
      query = query.or(orClauses.join(","));
    }

    const {
      data: rawReminders,
      count,
      error,
    } = await query
      .order(orderBy, { ascending: orderDirection === "asc" })
      .order("createdAt", { ascending: false })
      .range(skip, skip + take - 1);

    if (error) throw error;

    const totalReminders = count ?? 0;
    const reminders = (
      (rawReminders ?? []) as unknown as RawAssetReminderWithRelations[]
    ).map(flattenReminderTeamMembers);
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
}: Pick<Sb.AssetReminderRow, "id" | "name" | "message" | "organizationId"> & {
  alertDateTime: string | Date;
  teamMembers: string[];
}) {
  try {
    await validateTeamMembersForReminder(teamMembers, organizationId);

    /** This will act as a validation to check if reminder exists */
    const { data: reminder, error: findError } = await sbDb
      .from("AssetReminder")
      .select()
      .eq("id", id)
      .eq("organizationId", organizationId)
      .single();

    if (findError || !reminder) {
      throw findError || new Error("Reminder not found");
    }

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

    const alertDateTimeStr =
      typeof alertDateTime === "string"
        ? alertDateTime
        : alertDateTime.toISOString();

    /** Update the reminder row */
    const { data: updatedReminder, error: updateError } = await sbDb
      .from("AssetReminder")
      .update({ name, message, alertDateTime: alertDateTimeStr })
      .eq("id", reminder.id)
      .select()
      .single();

    if (updateError) throw updateError;

    /**
     * Replace team member associations:
     * 1. Delete all existing join rows for this reminder
     * 2. Insert the new set
     */
    const { error: deleteJoinError } = await sbDb
      .from("_AssetReminderToTeamMember")
      .delete()
      .eq("A", reminder.id);

    if (deleteJoinError) throw deleteJoinError;

    if (teamMembers.length > 0) {
      const joinRows = teamMembers.map((tmId) => ({
        A: reminder.id,
        B: tmId,
      }));
      const { error: insertJoinError } = await sbDb
        .from("_AssetReminderToTeamMember")
        .insert(joinRows);

      if (insertJoinError) throw insertJoinError;
    }

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
}: Pick<Sb.AssetReminderRow, "id" | "organizationId">) {
  try {
    const { data: deletedReminder, error } = await sbDb
      .from("AssetReminder")
      .delete()
      .eq("id", id)
      .eq("organizationId", organizationId)
      .select()
      .single();

    if (error) throw error;

    await cancelAssetReminderScheduler(deletedReminder);

    return deletedReminder;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while deleting reminder.",
      label,
    });
  }
}

export async function getUpcomingRemindersForHomePage({
  organizationId,
  take = 5,
}: {
  organizationId: string;
  take?: number;
}) {
  try {
    const { data: rawReminders, error } = await sbDb
      .from("AssetReminder")
      .select(ASSET_REMINDER_SELECT_WITH_RELATIONS)
      .eq("organizationId", organizationId)
      .gte("alertDateTime", new Date().toISOString())
      .order("alertDateTime", { ascending: true })
      .limit(take);

    if (error) throw error;

    return (
      (rawReminders ?? []) as unknown as RawAssetReminderWithRelations[]
    ).map(flattenReminderTeamMembers);
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
  assetId: string;
  organizationId: string;
}) {
  try {
    const { data: rawReminders, error } = await sbDb
      .from("AssetReminder")
      .select(ASSET_REMINDER_SELECT_WITH_RELATIONS)
      .eq("assetId", assetId)
      .eq("organizationId", organizationId)
      .gte("alertDateTime", new Date().toISOString())
      .order("alertDateTime", { ascending: false })
      .limit(2);

    if (error) throw error;

    return (
      (rawReminders ?? []) as unknown as RawAssetReminderWithRelations[]
    ).map(flattenReminderTeamMembers);
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while getting asset reminders.",
      label,
    });
  }
}
