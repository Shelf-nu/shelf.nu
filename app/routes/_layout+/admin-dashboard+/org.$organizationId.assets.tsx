import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";
import {
  bulkDeleteAssets,
  getPaginatedAndFilterableAssets,
  updateAssetsWithBookingCustodians,
} from "~/modules/asset/service.server";
import { CurrentSearchParamsSchema } from "~/modules/asset/utils.server";
import { checkExhaustiveSwitch } from "~/utils/check-exhaustive-switch";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { data, error, getParams, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requireAdmin, requirePermission } from "~/utils/roles.server";
import { AssetsList } from "../assets._index";

export const loader = async ({
  request,
  context,
  params,
}: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { organizationId } = getParams(
    params,
    z.object({ organizationId: z.string() }),
    { additionalData: { userId } }
  );

  try {
    await requireAdmin(userId);

    let {
      search,
      totalAssets,
      perPage,
      page,
      categories,
      tags,
      assets,
      totalPages,
      totalCategories,
      totalTags,
      locations,
      totalLocations,
      teamMembers,
      totalTeamMembers,
    } = await getPaginatedAndFilterableAssets({
      request,
      organizationId,
    });

    assets = await updateAssetsWithBookingCustodians(assets);
    const modelName = {
      singular: "asset",
      plural: "assets",
    };

    return json(
      data({
        items: assets,
        categories,
        tags,
        search,
        page,
        totalItems: totalAssets,
        perPage,
        totalPages,
        modelName,
        searchFieldLabel: "Search assets",
        searchFieldTooltip: {
          title: "Search your asset database",
          text: "Search assets based on asset name or description, category, tag, location, custodian name. Simply separate your keywords by a space: 'Laptop lenovo 2020'.",
        },
        totalCategories,
        totalTags,
        locations,
        totalLocations,
        teamMembers,
        totalTeamMembers,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, organizationId });
    throw json(error(reason), { status: reason.status });
  }
};

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const formData = await request.formData();

    const { intent } = parseData(
      formData,
      z.object({ intent: z.enum(["bulk-delete"]) })
    );

    const intent2ActionMap: { [K in typeof intent]: PermissionAction } = {
      "bulk-delete": PermissionAction.delete,
    };

    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: intent2ActionMap[intent],
    });

    switch (intent) {
      case "bulk-delete": {
        const { assetIds, currentSearchParams } = parseData(
          formData,
          z
            .object({ assetIds: z.array(z.string()).min(1) })
            .and(CurrentSearchParamsSchema)
        );

        await bulkDeleteAssets({
          assetIds,
          organizationId,
          userId,
          currentSearchParams,
        });

        sendNotification({
          title: "Assets deleted",
          message: "Your assets has been deleted successfully",
          icon: { name: "success", variant: "success" },
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

export default function AdminOrgQrCodes() {
  return (
    <>
      <div className="flex justify-between">
        <div className="flex items-end gap-3">
          <h2>Assets</h2>
          {/* <span>{members.length} total members</span> */}
        </div>
      </div>
      <AssetsList />
    </>
  );
}
