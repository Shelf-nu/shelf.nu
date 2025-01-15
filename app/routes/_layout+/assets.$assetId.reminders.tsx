import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import RemindersTable from "~/components/asset-reminder/reminders-table";
import type { HeaderData } from "~/components/layout/header/types";
import { getPaginatedAndFilterableReminders } from "~/modules/asset-reminder/service.server";
import { resolveRemindersActions } from "~/modules/asset-reminder/utils.server";
import { getDateTimeFormat } from "~/utils/client-hints";
import { makeShelfError } from "~/utils/error";
import { data, error, getParams } from "~/utils/http.server";
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
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.update,
    });

    return await resolveRemindersActions({
      request,
      organizationId,
      userId,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}

export default function AssetReminders() {
  return <RemindersTable isAssetReminderPage />;
}
