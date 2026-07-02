import { data } from "react-router";
import type {
  MetaFunction,
  LoaderFunctionArgs,
  ActionFunctionArgs,
} from "react-router";
import RemindersTable from "~/components/asset-reminder/reminders-table";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { getPaginatedAndFilterableReminders } from "~/modules/asset-reminder/service.server";
import { resolveRemindersActions } from "~/modules/asset-reminder/utils.server";
import { getOrganizationTierLimit } from "~/modules/tier/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError } from "~/utils/error";
import { payload, error } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { canUseRecurringReminders } from "~/utils/subscription.server";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId, organizations } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.assetReminders,
      action: PermissionAction.read,
    });

    const [
      { page, perPage, reminders, totalPages, totalReminders, search },
      tierLimit,
    ] = await Promise.all([
      getPaginatedAndFilterableReminders({
        organizationId,
        request,
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
      searchFieldLabel: "Search reminders",
      searchFieldTooltip: {
        title: "Search reminders",
        text: "Search reminders by reminder name, message, asset name or team member name. Separate your keywords by a comma(,) to search with OR condition. For example: searching 'Laptop, maintenance' will find reminders matching any of these terms.",
      },
      search,
      canUseRecurringReminders: canUseRecurringReminders(tierLimit),
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
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
      entity: PermissionEntity.assetReminders,
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

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data?.header.title) },
];

export default function Reminders() {
  return (
    <>
      <Header
        subHeading={
          <>
            To create a new reminder, navigate to the asset of your choice and
            use <b>{"Actions > Set Reminder"}</b>
          </>
        }
      />
      <RemindersTable />
    </>
  );
}
