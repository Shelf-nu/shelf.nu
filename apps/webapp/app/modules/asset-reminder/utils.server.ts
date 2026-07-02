import type { AssetReminder, Organization } from "@prisma/client";
import { DateTime, IANAZone } from "luxon";
import { redirect } from "react-router";
import { z } from "zod";
import { editReminderServerSchema } from "~/components/asset-reminder/set-or-edit-reminder-dialog";
import { checkExhaustiveSwitch } from "~/utils/check-exhaustive-switch";
import { getHints } from "~/utils/client-hints";
import { DATE_TIME_FORMAT } from "~/utils/constants";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfError, VALIDATION_ERROR } from "~/utils/error";
import { payload, parseData, safeRedirect } from "~/utils/http.server";
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
 * - The datetime-local string is wall-clock in the USER's zone (client-hint
 *   cookie); we parse it with luxon in a VALIDATED zone (tampered/unknown
 *   cookie values fall back to UTC instead of producing an Invalid Date).
 * - The "date must be in the future" rule is enforced HERE, against the
 *   correctly-resolved instant. The zod schemas deliberately skip it
 *   server-side: z.coerce.date() would read the raw string in the server's
 *   zone and wrongly reject valid future times for users west of UTC.
 * - The optional endsAt date (no time component) is interpreted as
 *   END-OF-DAY in that same zone so "ends on July 15" includes July 15's
 *   occurrence for users ahead of UTC.
 *
 * @throws {ShelfError} 400 with a field-level validation error (matching the
 *         parseData shape so the form shows it on the input) when the
 *         resolved alertDateTime is not in the future.
 */
export function resolveReminderPayloadDates({
  request,
  formData,
  repeat,
}: {
  request: Request;
  formData: FormData;
  repeat: ReminderRepeatValue;
}): { alertDateTime: Date; recurrence: ReminderRecurrenceInput } {
  const hints = getHints(request);
  const zone = IANAZone.isValidZone(hints.timeZone) ? hints.timeZone : "UTC";

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
  const endsAt = rawEndsAt
    ? DateTime.fromFormat(rawEndsAt, "yyyy-MM-dd", { zone })
        .endOf("day")
        .toJSDate()
    : null;

  return {
    alertDateTime,
    recurrence: {
      unit: preset.unit,
      interval: preset.interval,
      timezone: zone,
      endsAt: endsAt && !isNaN(endsAt.getTime()) ? endsAt : null,
    },
  };
}

/**
 * This function handles the editing and deleting of reminders..
 * It is currently used in the assets/$assetId/reminders & reminders index.
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
    z.object({ intent: z.enum(["edit-reminder", "delete-reminder"]) })
  );

  switch (intent) {
    case "edit-reminder": {
      const { redirectTo, ...payload } = parseData(
        formData,
        editReminderServerSchema,
        // Expected user-input validation (e.g. "Please select a date in the
        // future") — a 400, not a server error. The create path already opts
        // out; mirror it here (was noise: SHELF-WEBAPP-1ME).
        { shouldBeCaptured: false }
      );

      const { alertDateTime, recurrence } = resolveReminderPayloadDates({
        request,
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
