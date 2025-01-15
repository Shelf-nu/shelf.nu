import type { AssetReminder } from "@prisma/client";
import { json, redirect } from "@remix-run/node";
import { DateTime } from "luxon";
import { z } from "zod";
import { setReminderSchema } from "~/components/asset-reminder/set-or-edit-reminder-dialog";
import { checkExhaustiveSwitch } from "~/utils/check-exhaustive-switch";
import { getHints } from "~/utils/client-hints";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { data, parseData, safeRedirect } from "~/utils/http.server";
import { deleteAssetReminder, editAssetReminder } from "./service.server";

/**
 * This function handles the editing and deleting of reminders..
 * It is currently used in the assets/$assetId/reminders & reminders index.
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
    z.object({ intent: z.enum(["edit-reminder", "delete-reminder"]) })
  );

  switch (intent) {
    case "edit-reminder": {
      const { redirectTo, ...payload } = parseData(
        formData,
        setReminderSchema.extend({ id: z.string() })
      );

      const hints = getHints(request);
      const fmt = "yyyy-MM-dd'T'HH:mm";

      const alertDateTime = DateTime.fromFormat(
        formData.get("alertDateTime")!.toString()!,
        fmt,
        { zone: hints.timeZone }
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

      return json(data({ success: true }));
    }

    default: {
      checkExhaustiveSwitch(intent);
      return json(data(null));
    }
  }
}
