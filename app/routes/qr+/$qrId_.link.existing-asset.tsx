import { json, redirect, type LoaderFunctionArgs } from "@remix-run/node";
import { getPaginatedAndFilterableAssets } from "~/modules/asset";
import { userPrefs } from "~/utils/cookies.server";
import { ShelfStackError } from "~/utils/error";

import { PermissionAction, PermissionEntity } from "~/utils/permissions";
import { requirePermision } from "~/utils/roles.server";
import AssetIndexPage from "../_layout+/assets._index";

export const loader = async ({
  context,
  request,
  params,
}: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { organizationId } = await requirePermision({
    userId: authSession.userId,
    request,
    entity: PermissionEntity.qr,
    action: PermissionAction.update,
  });

  const { qrId } = params;

  let {
    search,
    totalAssets,
    perPage,
    page,
    categories,
    tags,
    assets,
    totalPages,
    cookie,
    totalCategories,
    totalTags,
  } = await getPaginatedAndFilterableAssets({
    request,
    organizationId,
  });

  if (totalPages !== 0 && page > totalPages) {
    return redirect(".");
  }

  if (!assets) {
    throw new ShelfStackError({
      title: "Hey!",
      message: `No assets found`,
      status: 404,
    });
  }
  const modelName = {
    singular: "asset",
    plural: "assets",
  };

  return json(
    {
      qrId,
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
    },
    {
      headers: [["Set-Cookie", await userPrefs.serialize(cookie)]],
    }
  );
};

export default function QrLinkExisting() {
  // const { qrId } = useLoaderData<typeof loader>();
  return <AssetIndexPage rowAction={(itemId) => console.log(itemId)} />;
}
