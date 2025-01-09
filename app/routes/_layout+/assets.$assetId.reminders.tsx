import { json, redirect } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { DateTime } from "luxon";
import { z } from "zod";
import RemindersTable from "~/components/asset-reminder/reminders-table";
import { setReminderSchema } from "~/components/asset-reminder/set-or-edit-reminder-dialog";
import type { HeaderData } from "~/components/layout/header/types";
import { Filters } from "~/components/list/filters";
import {
  deleteAssetReminder,
  editAssetReminder,
  getPaginatedAndFilterableReminders,
} from "~/modules/asset-reminder/service.server";
import { checkExhaustiveSwitch } from "~/utils/check-exhaustive-switch";
import { getDateTimeFormat, getHints } from "~/utils/client-hints";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import {
  data,
  error,
  getParams,
  parseData,
  safeRedirect,
} from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const userId = authSession.userId;

  const { assetId } = getParams(params, z.object({ assetId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.read,
    });

    const { reminders, totalReminders, page, perPage, totalPages } =
      await getPaginatedAndFilterableReminders({
        organizationId,
        request,
        where: { assetId },
      });

    const header: HeaderData = { title: "Reminders" };
    const modelName = {
      singular: "reminder",
      plural: "reminders",
    };

    const assetReminders = reminders.map((reminder) => ({
      ...reminder,
      displayDate: getDateTimeFormat(request, {
        dateStyle: "short",
        timeStyle: "short",
      }).format(reminder.alertDateTime),
    }));

    return json(
      data({
        header,
        modelName,
        items: assetReminders,
        totalItems: totalReminders,
        page,
        perPage,
        totalPages,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, assetId });
    throw json(error(reason), { status: reason.status });
  }
}

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const userId = authSession.userId;

  try {
    const formData = await request.formData();

    const { intent } = parseData(
      formData,
      z.object({ intent: z.enum(["edit-reminder", "delete-reminder"]) })
    );

    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.update,
    });

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
          senderId: authSession.userId,
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
          senderId: authSession.userId,
        });

        return json(data({ success: true }));
      }

      default: {
        checkExhaustiveSwitch(intent);
        return json(data(null));
      }
    }
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}

export default function AssetReminders() {
  return (
    <>
      <Filters className="mb-4" />
      <RemindersTable hideAssetColumn />
    </>
  );
}
