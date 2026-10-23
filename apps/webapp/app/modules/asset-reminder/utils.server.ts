import type { AssetReminder, Organization } from "@prisma/client";
import { DateTime, IANAZone } from "luxon";
import { redirect } from "react-router";
import { z } from "zod";
import { createSetReminderSchema } from "~/components/asset-reminder/set-or-edit-reminder-dialog";
import { checkExhaustiveSwitch } from "~/utils/check-exhaustive-switch";
import { getClientHint } from "~/utils/client-hints";
import { DATE_TIME_FORMAT } from "~/utils/constants";
import { resolveUserFormatPrefsById } from "~/utils/date-format.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfError, VALIDATION_ERROR } from "~/utils/error";
import { payload, parseData, safeRedirect } from "~/utils/http.server";
import { PermissionAction } from "~/utils/permissions/permission.data";
import { canUseRecurringReminders } from "~/utils/subscription.server";
import {
  REMINDER_REPEAT_PRESETS,
  type ReminderRepeatValue,
} from "./recurrence";
import type { ReminderRecurrenceInput } from "./service.server";
import { deleteAssetReminder, editAssetReminder } from "./service.server";
import { getOrganizationTierLimit } from "../tier/service.server";

type OrganizationsForTier = {
  id: string;
  type: Organization["type"];
  name: string;
  imageId: string | null;
  userId: string;
}[];

/**
 * Resolves the timezone-dependent parts of a reminder form submission:
 * the alertDateTime instant and the recurrence payload.
 *
 * - The datetime-local string is wall-clock in the acting user's resolved
 *   timezone preference (`resolveUserFormatPrefsById`), the same zone the form
 *   schema validated it in. It is parsed with luxon in a VALIDATED zone: an
 *   unknown value falls back to UTC instead of producing an Invalid Date.
 * - The "date must be in the future" rule is re-checked here against the
 *   resolved instant, so this function is safe to call on its own.
 * - The optional endsAt date (no time component) is interpreted as
 *   END-OF-DAY in that same zone so "ends on July 15" includes July 15's
 *   occurrence. The same zone is stored as the series' recurrence timezone.
 *
 * @throws {ShelfError} 400 with a field-level validation error (matching the
 *         parseData shape so the form shows it on the input) when the
 *         resolved alertDateTime is not in the future.
 */
export function resolveReminderPayloadDates({
  timeZone,
  formData,
  repeat,
}: {
  /** The acting user's resolved IANA timezone preference. */
  timeZone: string;
  formData: FormData;
  repeat: ReminderRepeatValue;
}): { alertDateTime: Date; recurrence: ReminderRecurrenceInput } {
  const zone = IANAZone.isValidZone(timeZone) ? timeZone : "UTC";

  const alertDateTime = DateTime.fromFormat(
    formData.get("alertDateTime")!.toString()!,
    DATE_TIME_FORMAT,
    { zone }
  ).toJSDate();

  if (isNaN(alertDateTime.getTime()) || alertDateTime.getTime() <= Date.now()) {
    throw new ShelfError({
      cause: null,
      title: "Validation error",
      message: "Please select a date in the future",
      additionalData: {
        [VALIDATION_ERROR]: {
          alertDateTime: { message: "Please select a date in the future" },
        },
      },
      label: "Asset Reminder",
      status: 400,
      shouldBeCaptured: false,
    });
  }

  if (repeat === "never") {
    return { alertDateTime, recurrence: null };
  }

  const preset = REMINDER_REPEAT_PRESETS[repeat];

  const rawEndsAt = formData.get("endsAt")?.toString();
  const parsedEndsAt = rawEndsAt
    ? DateTime.fromFormat(rawEndsAt, "yyyy-MM-dd", { zone })
        .endOf("day")
        .toJSDate()
    : null;
  const endsAt =
    parsedEndsAt && !isNaN(parsedEndsAt.getTime()) ? parsedEndsAt : null;

  /**
   * Authoritative endsAt ordering check on the ZONE-RESOLVED values (both in
   * the user's zone: endsAt as end-of-day, alertDateTime as the picked
   * instant). The zod schemas can't do this correctly: type="date" coerces
   * at UTC midnight while datetime-local coerces in the parser's zone, which
   * wrongly rejected valid same-day evening reminders west of UTC.
   */
  if (endsAt && endsAt.getTime() < alertDateTime.getTime()) {
    throw new ShelfError({
      cause: null,
      title: "Validation error",
      message: "End date must be on or after the reminder date",
      additionalData: {
        [VALIDATION_ERROR]: {
          endsAt: { message: "End date must be on or after the reminder date" },
        },
      },
      label: "Asset Reminder",
      status: 400,
      shouldBeCaptured: false,
    });
  }

  return {
    alertDateTime,
    recurrence: {
      unit: preset.unit,
      interval: preset.interval,
      timezone: zone,
      endsAt,
    },
  };
}

/** The reminder intents the reminder tables submit. */
const ReminderIntentSchema = z.enum(["edit-reminder", "delete-reminder"]);

/** A reminder-table intent. */
export type ReminderIntent = z.infer<typeof ReminderIntentSchema>;

/** The `assetReminders` permission each reminder intent needs. */
export const REMINDER_INTENT_PERMISSION: Record<
  ReminderIntent,
  PermissionAction
> = {
  "edit-reminder": PermissionAction.update,
  "delete-reminder": PermissionAction.delete,
};

/**
 * Reads the intent of a reminder-table submission without consuming the body,
 * so the route can gate on it before `resolveRemindersActions` parses the form.
 *
 * @param request - The action request
 * @returns The intent
 * @throws {ShelfError} 400 for a missing or unknown intent
 */
export async function readReminderIntent(
  request: Request
): Promise<ReminderIntent> {
  const { intent } = parseData(
    await request.clone().formData(),
    z.object({ intent: ReminderIntentSchema })
  );
  return intent;
}

/**
 * Handles the editing and deleting of reminders from the reminder tables on
 * the asset reminders page and the reminders index. The route gates the
 * intent with `REMINDER_INTENT_PERMISSION` before calling this.
 */
export async function resolveRemindersActions({
  request,
  organizationId,
  organizations,
  userId,
}: {
  request: Request;
  organizationId: AssetReminder["organizationId"];
  organizations: OrganizationsForTier;
  userId: AssetReminder["createdById"];
}) {
  const formData = await request.formData();

  const { intent } = parseData(
    formData,
    z.object({ intent: ReminderIntentSchema })
  );

  switch (intent) {
    case "edit-reminder": {
      // Resolve the acting user's RESOLVED timezone preference BEFORE validating
      // so the schema's "must be in the future" check runs in the SAME zone the
      // value is stored in (below) and the SAME zone the client validated in.
      // Validating with the default server-zone schema first, then storing in
      // the pref zone, lets the two disagree for a wall-clock time near "now".
      // Locale still comes from hints; only the timezone source changes.
      const { timeZone } = await resolveUserFormatPrefsById(
        userId,
        getClientHint(request)
      );

      const { redirectTo, ...payload } = parseData(
        formData,
        createSetReminderSchema({ timeZone }).extend({ id: z.string() }),
        // Expected user-input validation (e.g. "Please select a date in the
        // future") — a 400, not a server error. The create path already opts
        // out; mirror it here (was noise: SHELF-WEBAPP-1ME).
        { shouldBeCaptured: false }
      );

      const { alertDateTime, recurrence } = resolveReminderPayloadDates({
        timeZone,
        formData,
        repeat: payload.repeat,
      });

      /**
       * The tier capability is passed to the service, which only enforces it
       * when this edit ADDS or CHANGES recurrence relative to the stored row
       * (downgraded workspaces keep editing other fields).
       */
      const tierLimit = await getOrganizationTierLimit({
        organizationId,
        organizations,
      });

      await editAssetReminder({
        id: payload.id,
        name: payload.name,
        message: payload.message,
        teamMembers: payload.teamMembers,
        alertDateTime,
        recurrence,
        canUseRecurringReminders: canUseRecurringReminders(tierLimit),
        organizationId,
      });

      sendNotification({
        title: "Reminder updated",
        message: "Your asset reminder has been updated successfully",
        icon: { name: "success", variant: "success" },
        senderId: userId,
      });

      return redirect(safeRedirect(redirectTo));
    }

    case "delete-reminder": {
      const { id } = parseData(formData, z.object({ id: z.string().min(1) }));

      await deleteAssetReminder({ id, organizationId });

      sendNotification({
        title: "Reminder deleted",
        message: "Your asset reminder has been deleted successfully",
        icon: { name: "trash", variant: "error" },
        senderId: userId,
      });

      return payload({ success: true });
    }

    default: {
      checkExhaustiveSwitch(intent);
      return payload(null);
    }
  }
}
