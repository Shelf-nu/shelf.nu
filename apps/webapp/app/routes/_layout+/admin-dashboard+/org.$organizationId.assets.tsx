import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { AssetsList } from "~/components/assets/assets-index/assets-list";
import {
  getPaginatedAndFilterableAssets,
  updateAssetsWithBookingCustodians,
} from "~/modules/asset/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError } from "~/utils/error";
import { payload, error, getParams } from "~/utils/http.server";
import { requireAdmin } from "~/utils/roles.server";

export const meta = () => [{ title: appendToMetaTitle("Organization assets") }];

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
      // Shelf staff route, gated by `requireAdmin` above — and it renders the
      // custodian filter, so the seed must not be scoped to one person.
      canSeeAllCustody: true,
    });

    // Synchronous — no DB call. Booking custodian data is already included
    // in the initial asset query (via assetIndexFields), so this just reshapes
    // it into the `custody.custodian` structure the UI expects.
    assets = updateAssetsWithBookingCustodians(assets);
    const modelName = {
      singular: "asset",
      plural: "assets",
    };

    return payload({
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
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, organizationId });
    throw data(error(reason), { status: reason.status });
  }
};

export default function AdminOrgQrAssets() {
  return (
    <>
      <div className="flex justify-between">
        <div className="flex items-end gap-3">
          <h2>Assets</h2>
        </div>
      </div>
      <AssetsList disableBulkActions />
    </>
  );
}
