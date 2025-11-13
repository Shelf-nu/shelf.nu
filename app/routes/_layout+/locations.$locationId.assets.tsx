import type { Asset, Category, Tag, Location } from "@prisma/client";
import type { LoaderFunctionArgs } from "react-router";
import { data , useLoaderData } from "react-router";
import z from "zod";
import { AssetImage } from "~/components/assets/asset-image";
import { AssetStatusBadge } from "~/components/assets/asset-status-badge";
import { ASSET_SORTING_OPTIONS } from "~/components/assets/assets-index/filters";
import { ListItemTagsColumn } from "~/components/assets/assets-index/list-item-tags-column";
import { CategoryBadge } from "~/components/assets/category-badge";
import ContextualModal from "~/components/layout/contextual-modal";
import ContextualSidebar from "~/components/layout/contextual-sidebar";
import type { HeaderData } from "~/components/layout/header/types";
import { List } from "~/components/list";
import { Filters } from "~/components/list/filters";
import { SortBy } from "~/components/list/filters/sort-by";
import { Button } from "~/components/shared/button";
import TextualDivider from "~/components/shared/textual-divider";
import { Td, Th } from "~/components/table";
import When from "~/components/when/when";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { getLocation } from "~/modules/location/service.server";
import { updateCookieWithPerPage } from "~/utils/cookies.server";
import { makeShelfError } from "~/utils/error";
import {
  payload,
  error,
  getCurrentSearchParams,
  getParams,
} from "~/utils/http.server";
import { getParamsValues } from "~/utils/list";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { requirePermission } from "~/utils/roles.server";

const paramsSchema = z.object({ locationId: z.string() });

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const { userId } = context.getSession();
  const { locationId } = getParams(params, paramsSchema);

  try {
    const { organizationId, userOrganizations } = await requirePermission({
      request,
      userId,
      entity: PermissionEntity.location,
      action: PermissionAction.read,
    });

    const searchParams = getCurrentSearchParams(request);
    const { page, perPageParam, search, orderBy, orderDirection } =
      getParamsValues(searchParams);
    const cookie = await updateCookieWithPerPage(request, perPageParam);
    const { perPage } = cookie;

    const { location, totalAssetsWithinLocation } = await getLocation({
      organizationId,
      id: locationId,
      page,
      perPage,
      search,
      orderBy,
      orderDirection,
      userOrganizations,
      request,
    });

    const modelName = {
      singular: "asset",
      plural: "assets",
    };

    const totalItems = totalAssetsWithinLocation;
    const totalPages = Math.ceil(totalAssetsWithinLocation / perPage);

    const header: HeaderData = {
      title: `${location.name} - Assets`,
      subHeading: location.id,
    };

    return payload({
      location,
      header,
      modelName,
      items: location.assets,
      page,
      totalItems,
      perPage,
      totalPages,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, locationId });
    throw data(error(reason), { status: reason.status });
  }
}

export default function LocationAssets() {
  const { roles } = useUserRoleHelper();
  const { location } = useLoaderData<typeof loader>();
  const userRoleCanManageAssets = userHasPermission({
    roles,
    entity: PermissionEntity.location,
    action: PermissionAction.manageAssets,
  });

  return (
    <>
      <ContextualSidebar />
      <ContextualModal />

      <TextualDivider text="Assets" className="mb-4 lg:hidden" />
      <div className="flex flex-col md:gap-2">
        <Filters
          className="responsive-filters mb-2 lg:mb-0"
          slots={{
            "right-of-search": (
              <SortBy
                sortingOptions={ASSET_SORTING_OPTIONS}
                defaultSortingBy="createdAt"
              />
            ),
          }}
        >
          <div className="mt-2 flex w-full items-center gap-2  md:mt-0">
            <When truthy={userRoleCanManageAssets}>
              <Button
                icon="scan"
                variant="secondary"
                to={`/locations/${location.id}/scan-assets-kits`}
                width="full"
              >
                Scan
              </Button>
              <Button
                to="manage-assets"
                variant="primary"
                width="full"
                className="whitespace-nowrap"
              >
                Add assets
              </Button>
            </When>
          </div>
        </Filters>
        <List
          className=""
          ItemComponent={ListAssetContent}
          headerChildren={
            <>
              <Th>Category</Th>
              <Th>Tags</Th>
            </>
          }
          customEmptyStateContent={{
            title: "There are currently no assets at the location",
            text: "Add assets in this location",
            newButtonRoute: "manage-assets",
            newButtonContent: "Add asset",
          }}
        />
      </div>
    </>
  );
}

const ListAssetContent = ({
  item,
}: {
  item: Asset & {
    category: Pick<Category, "id" | "name" | "color"> | null;
    tags?: Tag[];
    location?: Location;
  };
}) => {
  const { category, tags } = item;
  return (
    <>
      <Td className="w-full whitespace-normal p-0 md:p-0">
        <div className="flex justify-between gap-3 p-4  md:justify-normal md:px-6">
          <div className="flex items-center gap-3">
            <div className="relative flex size-14 shrink-0 items-center justify-center">
              <AssetImage
                asset={{
                  id: item.id,
                  mainImage: item.mainImage,
                  thumbnailImage: item.thumbnailImage,
                  mainImageExpiration: item.mainImageExpiration,
                }}
                alt={`Image of ${item.title}`}
                className="size-full rounded-[4px] border object-cover"
                withPreview
              />
            </div>
            <div className="min-w-[180px]">
              <span className="word-break mb-1 block font-medium">
                <Button
                  to={`/assets/${item.id}`}
                  variant="link"
                  className="text-left text-gray-900 hover:text-gray-700"
                  target="_blank"
                  onlyNewTabIconOnHover={true}
                >
                  {item.title}
                </Button>
              </span>
              <AssetStatusBadge
                id={item.id}
                status={item.status}
                availableToBook={item.availableToBook}
              />
            </div>
          </div>
        </div>
      </Td>

      <Td>
        <CategoryBadge category={category} />
      </Td>
      <Td className="text-left">
        <ListItemTagsColumn tags={tags} />
      </Td>
    </>
  );
};
