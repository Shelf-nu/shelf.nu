import { useEffect, useMemo } from "react";
import { AssetStatus, type Prisma } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useNavigation } from "@remix-run/react";
import { useAtomValue, useSetAtom } from "jotai";
import { z } from "zod";
import {
  selectedBulkItemsAtom,
  selectedBulkItemsCountAtom,
  setSelectedBulkItemAtom,
  setSelectedBulkItemsAtom,
} from "~/atoms/list";
import { AssetImage } from "~/components/assets/asset-image";
import { AssetStatusBadge } from "~/components/assets/asset-status-badge";
import { ASSET_INDEX_SORTING_OPTIONS } from "~/components/assets/assets-index/filters";
import { StatusFilter } from "~/components/booking/status-filter";
import { Form } from "~/components/custom-form";
import DynamicDropdown from "~/components/dynamic-dropdown/dynamic-dropdown";
import { ChevronRight } from "~/components/icons/library";
import { List } from "~/components/list";
import { Filters } from "~/components/list/filters";
import { SortBy } from "~/components/list/filters/sort-by";
import { Badge } from "~/components/shared/badge";
import { Button } from "~/components/shared/button";
import { Image } from "~/components/shared/image";

import { Td, Th } from "~/components/table";
import { db } from "~/database/db.server";
import {
  createBulkLocationChangeNotes,
  getPaginatedAndFilterableAssets,
} from "~/modules/asset/service.server";

import { getAssetsWhereInput } from "~/modules/asset/utils.server";
import { ShelfError, makeShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import {
  data,
  error,
  getCurrentSearchParams,
  getParams,
  parseData,
} from "~/utils/http.server";
import { ALL_SELECTED_KEY, isSelectingAllItems } from "~/utils/list";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { tw } from "~/utils/tw";
import { ListItemTagsColumn } from "./assets._index";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { locationId } = getParams(
    params,
    z.object({ locationId: z.string() }),
    {
      additionalData: { userId },
    }
  );

  try {
    const { organizationId } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.location,
      action: PermissionAction.update,
    });

    const location = await db.location
      .findUniqueOrThrow({
        where: {
          id: locationId,
          organizationId,
        },
        include: {
          assets: {
            select: { id: true },
          },
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          title: "Location not found",
          message:
            "The location you are trying to access does not exist or you do not have permission to access it.",
          additionalData: { locationId, userId, organizationId },
          status: 404,
          label: "Location",
        });
      });

    const {
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
    } = await getPaginatedAndFilterableAssets({
      request,
      organizationId,
    });

    const modelName = {
      singular: "asset",
      plural: "assets",
    };

    return json(
      data({
        header: {
          title: `Move assets to ‘${location?.name}’ location`,
          subHeading:
            "Search your database for assets that you would like to move to this location.",
        },
        showSidebar: true,
        noScroll: true,
        items: assets,
        categories,
        tags,
        search,
        page,
        totalItems: totalAssets,
        perPage,
        totalPages,
        modelName,
        location,
        totalCategories,
        totalTags,
        locations,
        totalLocations,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, locationId });
    throw json(error(reason), { status: reason.status });
  }
}

export async function action({ context, request, params }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { locationId } = getParams(
    params,
    z.object({ locationId: z.string() }),
    {
      additionalData: { userId },
    }
  );

  try {
    const { organizationId } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.location,
      action: PermissionAction.update,
    });

    let { assetIds, removedAssetIds } = parseData(
      await request.formData(),
      z.object({
        assetIds: z.array(z.string()).optional().default([]),
        removedAssetIds: z.array(z.string()).optional().default([]),
      }),
      {
        additionalData: { userId, organizationId, locationId },
      }
    );

    const location = await db.location
      .findUniqueOrThrow({
        where: {
          id: locationId,
          organizationId,
        },
        include: {
          assets: true,
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message: "Location not found",
          additionalData: { locationId, userId, organizationId },
          status: 404,
          label: "Location",
        });
      });

    /**
     * If user has selected all assets, then we have to get ids of all those assets
     * with respect to the filters applied.
     * */
    const hasSelectedAll = assetIds.includes(ALL_SELECTED_KEY);
    if (hasSelectedAll) {
      const searchParams = getCurrentSearchParams(request);
      const assetsWhere = getAssetsWhereInput({
        organizationId,
        currentSearchParams: searchParams.toString(),
      });

      const allAssets = await db.asset.findMany({
        where: assetsWhere,
        select: { id: true },
      });

      const locationAssets = location.assets.map((asset) => asset.id);
      /**
       * New assets that needs to be added are
       * - Previously added assets
       * - All assets with applied filters
       */
      assetIds = [
        ...new Set([
          ...allAssets.map((asset) => asset.id),
          ...locationAssets.filter((asset) => !removedAssetIds.includes(asset)),
        ]),
      ];
    }

    /**
     * We need to query all the modified assets so we know their location before the change
     * That way we can later create notes for all the location changes
     */
    const modifiedAssets = await db.asset
      .findMany({
        where: {
          id: {
            in: [...assetIds, ...removedAssetIds],
          },
          organizationId,
        },
        select: {
          title: true,
          id: true,
          location: {
            select: {
              name: true,
              id: true,
            },
          },
          user: {
            select: {
              firstName: true,
              lastName: true,
              id: true,
            },
          },
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message:
            "Something went wrong while fetching the assets. Please try again or contact support.",
          additionalData: { assetIds, removedAssetIds, userId, locationId },
          label: "Assets",
        });
      });

    if (assetIds.length > 0) {
      /** We update the location with the new assets */
      await db.location
        .update({
          where: {
            id: locationId,
            organizationId,
          },
          data: {
            assets: {
              connect: assetIds.map((id) => ({
                id,
              })),
            },
          },
        })
        .catch((cause) => {
          throw new ShelfError({
            cause,
            message:
              "Something went wrong while adding the assets to the location. Please try again or contact support.",
            additionalData: { assetIds, userId, locationId },
            label: "Location",
          });
        });
    }

    /** If some assets were removed, we also need to handle those */
    if (removedAssetIds.length > 0) {
      await db.location
        .update({
          where: {
            organizationId,
            id: locationId,
          },
          data: {
            assets: {
              disconnect: removedAssetIds.map((id) => ({
                id,
              })),
            },
          },
        })
        .catch((cause) => {
          throw new ShelfError({
            cause,
            message:
              "Something went wrong while removing the assets from the location. Please try again or contact support.",
            additionalData: { removedAssetIds, userId, locationId },
            label: "Location",
          });
        });
    }

    /** Creates the relevant notes for all the changed assets */
    await createBulkLocationChangeNotes({
      modifiedAssets,
      assetIds,
      removedAssetIds,
      userId: authSession.userId,
      location,
    });

    return redirect(`/locations/${locationId}`);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, locationId });
    return json(error(reason), { status: reason.status });
  }
}

export default function AddAssetsToLocation() {
  const { location, totalItems } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSearching = isFormProcessing(navigation.state);

  const selectedBulkItems = useAtomValue(selectedBulkItemsAtom);
  const updateItem = useSetAtom(setSelectedBulkItemAtom);
  const setSelectedBulkItems = useSetAtom(setSelectedBulkItemsAtom);
  const selectedBulkItemsCount = useAtomValue(selectedBulkItemsCountAtom);
  const hasSelectedAllItems = isSelectingAllItems(selectedBulkItems);

  const removedAssets = useMemo(
    () =>
      location.assets.filter(
        (asset) =>
          !selectedBulkItems.some(
            (selectedItem) => selectedItem.id === asset.id
          )
      ),
    [location.assets, selectedBulkItems]
  );

  /**
   * Set selected items for kit based on the route data
   */
  useEffect(() => {
    setSelectedBulkItems(location.assets);
  }, [location.assets, setSelectedBulkItems]);

  return (
    <div className="flex h-full max-h-full flex-col">
      {/* Search */}
      <div className=" border-b px-6 md:pb-3">
        <Filters
          className="md:border-0 md:p-0"
          slots={{
            "left-of-search": <StatusFilter statusItems={AssetStatus} />,
            "right-of-search": (
              <SortBy
                sortingOptions={ASSET_INDEX_SORTING_OPTIONS}
                defaultSortingBy="createdAt"
              />
            ),
          }}
        ></Filters>
      </div>
      {/* Filters */}
      <div className=" flex  justify-around gap-2 border-b p-3 lg:gap-4">
        <DynamicDropdown
          trigger={
            <div className="flex h-6 cursor-pointer items-center gap-2">
              Categories <ChevronRight className="hidden rotate-90 md:inline" />
            </div>
          }
          model={{ name: "category", queryKey: "name" }}
          label="Filter by category"
          placeholder="Search categories"
          initialDataKey="categories"
          countKey="totalCategories"
        />
        <DynamicDropdown
          trigger={
            <div className="flex h-6 cursor-pointer items-center gap-2">
              Tags <ChevronRight className="hidden rotate-90 md:inline" />
            </div>
          }
          model={{ name: "tag", queryKey: "name" }}
          label="Filter by tag"
          initialDataKey="tags"
          countKey="totalTags"
        />
        <DynamicDropdown
          trigger={
            <div className="flex h-6 cursor-pointer items-center gap-2">
              Locations <ChevronRight className="hidden rotate-90 md:inline" />
            </div>
          }
          model={{ name: "location", queryKey: "name" }}
          label="Filter by location"
          initialDataKey="locations"
          countKey="totalLocations"
          renderItem={({ metadata }) => (
            <div className="flex items-center gap-2">
              <Image
                imageId={metadata.imageId}
                alt="img"
                className={tw(
                  "size-6 rounded-[2px] object-cover",
                  metadata.description ? "rounded-b-none border-b-0" : ""
                )}
              />
              <div>{metadata.name}</div>
            </div>
          )}
        />
      </div>

      {/* List */}
      <div className="  flex-1 overflow-y-auto px-5 md:px-0">
        <List
          ItemComponent={RowComponent}
          /** Clicking on the row will add the current asset to the atom of selected assets */
          navigate={(_assetId, item) => {
            updateItem(item);
          }}
          customEmptyStateContent={{
            title: "You haven't added any assets yet.",
            text: "What are you waiting for? Create your first asset now!",
            newButtonRoute: "/assets/new",
            newButtonContent: "New asset",
          }}
          className="-mx-5 flex h-full flex-col justify-start border-0"
          bulkActions={<> </>}
          headerChildren={
            <>
              <Th>Location</Th>
              <Th>Category</Th>
              <Th>Tags</Th>
            </>
          }
        />
      </div>
      {/* Footer of the modal */}
      <footer className="item-center mt-auto flex shrink-0 justify-between border-t px-6 py-3">
        <p>
          {hasSelectedAllItems ? totalItems : selectedBulkItemsCount} selected
        </p>

        <div className="flex gap-3">
          <Button variant="secondary" to={".."}>
            Close
          </Button>
          <Form method="post">
            {/* We create inputs for both the removed and selected assets, so we can compare and easily add/remove */}
            {/* These are the asset ids, coming from the server */}
            {removedAssets.map((asset, i) => (
              <input
                key={asset.id}
                type="hidden"
                name={`removedAssetIds[${i}]`}
                value={asset.id}
              />
            ))}
            {/* These are the ids selected by the user and stored in the atom */}
            {selectedBulkItems.map((asset, i) => (
              <input
                key={asset.id}
                type="hidden"
                name={`assetIds[${i}]`}
                value={asset.id}
              />
            ))}
            <Button
              type="submit"
              name="intent"
              value="addAssets"
              disabled={isSearching}
            >
              Confirm
            </Button>
          </Form>
        </div>
      </footer>
    </div>
  );
}

const RowComponent = ({
  item,
}: {
  item: Prisma.AssetGetPayload<{
    include: {
      location: true;
      category: true;
      tags: true;
    };
  }>;
}) => {
  const { tags, category } = item;

  return (
    <>
      {/* Name */}
      <Td className="w-full min-w-[330px] p-0 md:p-0">
        <div className="flex justify-between gap-3 p-4 md:px-6">
          <div className="flex items-center gap-3">
            <div className="flex size-12 shrink-0 items-center justify-center">
              <AssetImage
                asset={{
                  assetId: item.id,
                  mainImage: item.mainImage,
                  mainImageExpiration: item.mainImageExpiration,
                  alt: item.title,
                }}
                className="size-full rounded-[4px] border object-cover"
              />
            </div>
            <div className="flex flex-col gap-y-1">
              <p className="word-break whitespace-break-spaces font-medium">
                {item.title}
              </p>
              <AssetStatusBadge
                status={item.status}
                availableToBook={item.availableToBook}
              />
            </div>
          </div>
        </div>
      </Td>

      {/* Location */}
      <Td>
        {item.location ? (
          <div
            className="flex items-center gap-1 text-[12px] font-medium text-gray-700"
            title={`Current location: ${item.location.name}`}
          >
            <div className="size-2 rounded-full bg-gray-500"></div>
            <span>{item.location.name}</span>
          </div>
        ) : null}
      </Td>

      {/* Category */}
      <Td>
        {category ? (
          <Badge color={category.color} withDot={false}>
            {category.name}
          </Badge>
        ) : (
          <Badge color="#575757" withDot={false}>
            Uncategorized
          </Badge>
        )}
      </Td>

      {/* Tags */}
      <Td className="text-left">
        <ListItemTagsColumn tags={tags} />
      </Td>
    </>
  );
};
