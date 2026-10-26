import type { AssetReminder } from "@prisma/client";
import { DateTime } from "luxon";
import { redirect } from "react-router";
import { z } from "zod";
import { createSetReminderSchema } from "~/components/asset-reminder/set-or-edit-reminder-dialog";
import { checkExhaustiveSwitch } from "~/utils/check-exhaustive-switch";
import { getClientHint } from "~/utils/client-hints";
import { DATE_TIME_FORMAT } from "~/utils/constants";
import { resolveUserFormatPrefsById } from "~/utils/date-format.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { payload, parseData, safeRedirect } from "~/utils/http.server";
import { PermissionAction } from "~/utils/permissions/permission.data";
import { deleteAssetReminder, editAssetReminder } from "./service.server";

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
  userId,
}: {
  request: Request;
  organizationId: AssetReminder["organizationId"];
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

      const alertDateTime = DateTime.fromFormat(
        formData.get("alertDateTime")!.toString()!,
        DATE_TIME_FORMAT,
        { zone: timeZone }
      ).toJSDate();

      await editAssetReminder({
        id: payload.id,
        name: payload.name,
        message: payload.message,
        teamMembers: payload.teamMembers,
        alertDateTime,
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
