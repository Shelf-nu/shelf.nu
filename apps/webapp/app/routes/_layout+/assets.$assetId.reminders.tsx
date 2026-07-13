import { data, type MetaFunction } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import RemindersTable from "~/components/asset-reminder/reminders-table";
import type { HeaderData } from "~/components/layout/header/types";
import { getPaginatedAndFilterableReminders } from "~/modules/asset-reminder/service.server";
import { resolveRemindersActions } from "~/modules/asset-reminder/utils.server";
import { getOrganizationTierLimit } from "~/modules/tier/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError } from "~/utils/error";
import { payload, error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { canUseRecurringReminders } from "~/utils/subscription.server";

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const userId = authSession.userId;

  const { assetId } = getParams(params, z.object({ assetId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId, organizations } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.assetReminders,
      action: PermissionAction.read,
    });

    const [
      { reminders, totalReminders, page, perPage, totalPages, search },
      tierLimit,
    ] = await Promise.all([
      getPaginatedAndFilterableReminders({
        organizationId,
        request,
        where: { assetId },
      }),
      getOrganizationTierLimit({ organizationId, organizations }),
    ]);

    const header: HeaderData = { title: "Reminders" };
    const modelName = {
      singular: "reminder",
      plural: "reminders",
    };

    return payload({
      header,
      modelName,
      items: reminders,
      totalItems: totalReminders,
      page,
      perPage,
      totalPages,
      search,
      canUseRecurringReminders: canUseRecurringReminders(tierLimit),
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, assetId });
    throw data(error(reason), { status: reason.status });
  }
}

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const userId = authSession.userId;

  try {
    const { organizationId, organizations } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.update,
    });

    return await resolveRemindersActions({
      request,
      organizationId,
      organizations,
      userId,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}

export default function AssetReminders() {
  return <RemindersTable isAssetReminderPage />;
}
