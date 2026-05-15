import {
  data,
  useParams,
  type LoaderFunctionArgs,
  type MetaFunction,
} from "react-router";
import { z } from "zod";
import { AssetImage } from "~/components/assets/asset-image";
import { AssetStatusBadge } from "~/components/assets/asset-status-badge";
import { ASSET_SORTING_OPTIONS } from "~/components/assets/assets-index/filters";
import { ListItemTagsColumn } from "~/components/assets/assets-index/list-item-tags-column";
import { CategoryBadge } from "~/components/assets/category-badge";
import AssetRowActionsDropdown from "~/components/kits/asset-row-actions-dropdown";
import ContextualModal from "~/components/layout/contextual-modal";
import ContextualSidebar from "~/components/layout/contextual-sidebar";
import type { HeaderData } from "~/components/layout/header/types";
import { List } from "~/components/list";
import { Filters } from "~/components/list/filters";
import { SortBy } from "~/components/list/filters/sort-by";
import { LocationBadge } from "~/components/location/location-badge";
import { Button } from "~/components/shared/button";
import { Td, Th } from "~/components/table";
import When from "~/components/when/when";
import { db } from "~/database/db.server";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { isQuantityTracked } from "~/modules/asset/utils";
import { getAssetsForKits } from "~/modules/kit/service.server";
import type { ListItemForKitPage } from "~/modules/kit/types";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError } from "~/utils/error";
import { payload, error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { requirePermission } from "~/utils/roles.server";

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

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

    /**
     * Run the assets query and a tiny kit-name lookup in parallel so the
     * page can render `${kit.name}'s assets` (matches the sibling overview
     * route's title pattern) without an extra round-trip.
     */
    const [assets, kit] = await Promise.all([
      getAssetsForKits({
        request,
        organizationId,
        kitId,
        ignoreFilters: isManageAssetsUrl,
      }),
      db.kit.findFirst({
        where: { id: kitId, organizationId },
        select: { name: true },
      }),
    ]);

    const header: HeaderData = {
      title: kit ? `${kit.name}'s assets` : "Kit assets",
    };

    const modelName = {
      singular: "asset",
      plural: "assets",
    };

    return payload({
      header,
      ...assets,
      modelName,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, kitId });
    throw data(error(reason), { status: reason.status });
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
                Add assets
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
              ? "Add assets"
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

  // `kitId` from the URL — used below to pick this asset's pivot row out
  // of `item.assetKits` (the asset can be in multiple kits since
  // Phase 4a-Polish-2; we only care about THIS kit's slice here).
  const { kitId } = useParams<{ kitId: string }>();

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
                alt={`Image of ${item.title}`}
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
                {isQuantityTracked(item)
                  ? (() => {
                      /**
                       * Render `· N units in kit` for qty-tracked rows.
                       *
                       * Phase 4a-Polish-2: `AssetKit.quantity` is the
                       * source of truth — the picker writes it, the
                       * kit-custody inherit helper reads it, reports read
                       * it. We surface the kit-specific count only; the
                       * asset's total is irrelevant on the kit page (and
                       * a user comparing N/M would be confused if the
                       * same qty-tracked asset is split across multiple
                       * kits). The `find()` is defensive — the asset was
                       * fetched via `assetKits: { some: { kitId } }`, so
                       * a missing row shouldn't happen.
                       */
                      const unit = item.unitOfMeasure || "units";
                      const inKit =
                        item.assetKits.find((ak) => ak.kitId === kitId)
                          ?.quantity ?? 0;
                      return (
                        <span className="ml-2 text-xs text-gray-500">
                          · {inKit} {unit} in kit
                        </span>
                      );
                    })()
                  : null}
              </span>
              <AssetStatusBadge
                id={item.id}
                status={item.status}
                availableToBook={item.availableToBook}
                asset={item}
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
          <LocationBadge
            location={{
              id: location.id,
              name: location.name,
              parentId: location.parentId ?? undefined,
              childCount: location._count?.children ?? 0,
            }}
          />
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
