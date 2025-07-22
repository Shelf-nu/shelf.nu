import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { AssetImage } from "~/components/assets/asset-image";
import { AssetStatusBadge } from "~/components/assets/asset-status-badge";
import { ListItemTagsColumn } from "~/components/assets/assets-index/assets-list";
import { ASSET_SORTING_OPTIONS } from "~/components/assets/assets-index/filters";
import { CategoryBadge } from "~/components/assets/category-badge";
import AssetRowActionsDropdown from "~/components/kits/asset-row-actions-dropdown";
import ContextualModal from "~/components/layout/contextual-modal";
import ContextualSidebar from "~/components/layout/contextual-sidebar";
import type { HeaderData } from "~/components/layout/header/types";
import { List } from "~/components/list";
import { Filters } from "~/components/list/filters";
import { SortBy } from "~/components/list/filters/sort-by";
import { Button } from "~/components/shared/button";
import { GrayBadge } from "~/components/shared/gray-badge";
import { Td, Th } from "~/components/table";
import When from "~/components/when/when";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { getAssetsForKits } from "~/modules/kit/service.server";
import type { ListItemForKitPage } from "~/modules/kit/types";
import { makeShelfError } from "~/utils/error";
import { data, error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const { userId } = context.getSession();
  const { kitId } = getParams(params, z.object({ kitId: z.string() }));

  try {
    const { organizationId } = await requirePermission({
      request,
      userId,
      entity: PermissionEntity.kit,
      action: PermissionAction.read,
    });

    const isManageAssetsUrl = request.url.includes("manage-assets");

    const assets = await getAssetsForKits({
      request,
      organizationId,
      kitId,
      ignoreFilters: isManageAssetsUrl,
    });

    const header: HeaderData = { title: "Kit assets" };

    const modelName = {
      singular: "asset",
      plural: "assets",
    };

    return json(
      data({
        header,
        ...assets,
        modelName,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, kitId });
    throw json(error(reason), { status: reason.status });
  }
}

export default function KitAssets() {
  const { roles } = useUserRoleHelper();

  const userRoleCanManageAssets = userHasPermission({
    roles,
    entity: PermissionEntity.kit,
    action: PermissionAction.manageAssets,
  });

  return (
    <>
      <ContextualSidebar />
      <ContextualModal />

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
          <When truthy={userRoleCanManageAssets}>
            <div className="mt-2 flex w-full items-center gap-2 md:mt-0">
              <Button
                icon="scan"
                variant="secondary"
                to="../scan-assets"
                width={"full"}
              >
                Scan
              </Button>
              <Button
                to="manage-assets?status=AVAILABLE"
                variant="primary"
                width="full"
                className="whitespace-nowrap"
              >
                Manage assets
              </Button>
            </div>
          </When>
        </Filters>

        <List
          ItemComponent={ListContent}
          customEmptyStateContent={{
            title: "Not assets in kit",
            text: userRoleCanManageAssets
              ? "Start by adding your first asset."
              : "",
            newButtonContent: userRoleCanManageAssets
              ? "Manage assets"
              : undefined,
            newButtonRoute: userRoleCanManageAssets
              ? "manage-assets?status=AVAILABLE"
              : undefined,
          }}
          headerChildren={
            <>
              <Th>Category</Th>
              <Th>Location</Th>
              <Th>Tags</Th>
            </>
          }
        />
      </div>
    </>
  );
}

function ListContent({ item }: { item: ListItemForKitPage }) {
  const { location, category, tags } = item;

  const { roles } = useUserRoleHelper();
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
                alt={item.title}
                className="size-full rounded-[4px] border object-cover"
                withPreview
              />
            </div>
            <div className="min-w-[180px]">
              <span className="word-break mb-1 block">
                <Button
                  to={`/assets/${item.id}`}
                  variant="link"
                  className="text-left font-medium text-gray-900 hover:text-gray-700"
                  target={"_blank"}
                  onlyNewTabIconOnHover
                >
                  {item.title}
                </Button>
              </span>
              <AssetStatusBadge
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

      <Td>
        {location ? (
          <GrayBadge>
            <span>{location.name}</span>
          </GrayBadge>
        ) : null}
      </Td>
      {/* Tags */}
      <Td className="text-left">
        <ListItemTagsColumn tags={tags} />
      </Td>

      <When
        truthy={userHasPermission({
          roles,
          entity: PermissionEntity.asset,
          action: PermissionAction.manageAssets,
        })}
      >
        <Td className="pr-4 text-right">
          <AssetRowActionsDropdown asset={item} />
        </Td>
      </When>
    </>
  );
}
