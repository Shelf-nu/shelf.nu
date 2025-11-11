import { useEffect, useMemo, useRef, useState } from "react";
import { AssetStatus, type Prisma } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import {
  useLoaderData,
  useNavigate,
  useNavigation,
  useSubmit,
} from "react-router";
import { useAtomValue, useSetAtom } from "jotai";
import { z } from "zod";
import {
  selectedBulkItemsAtom,
  selectedBulkItemsCountAtom,
  setSelectedBulkItemAtom,
  setSelectedBulkItemsAtom,
} from "~/atoms/list";
import { AssetImage } from "~/components/assets/asset-image/component";
import { AssetStatusBadge } from "~/components/assets/asset-status-badge";
import { ASSET_SORTING_OPTIONS } from "~/components/assets/assets-index/filters";
import { ListItemTagsColumn } from "~/components/assets/assets-index/list-item-tags-column";
import { CategoryBadge } from "~/components/assets/category-badge";
import { StatusFilter } from "~/components/booking/status-filter";
import { Form } from "~/components/custom-form";
import DynamicDropdown from "~/components/dynamic-dropdown/dynamic-dropdown";
import { ChevronRight } from "~/components/icons/library";
import ImageWithPreview from "~/components/image-with-preview/image-with-preview";
import { List } from "~/components/list";
import { Filters } from "~/components/list/filters";
import { SortBy } from "~/components/list/filters/sort-by";
import { Button } from "~/components/shared/button";
import { GrayBadge } from "~/components/shared/gray-badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "~/components/shared/tabs";
import { Td, Th } from "~/components/table";
import UnsavedChangesAlert from "~/components/unsaved-changes-alert";
import { db } from "~/database/db.server";
import { getPaginatedAndFilterableAssets } from "~/modules/asset/service.server";
import { updateLocationAssets } from "~/modules/location/service.server";
import { ShelfError, makeShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { payload, error, getParams, parseData } from "~/utils/http.server";
import { isSelectingAllItems } from "~/utils/list";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

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
          kits: { select: { id: true } },
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

    return payload({
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
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, locationId });
    throw data(error(reason), { status: reason.status });
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

    let { assetIds, removedAssetIds, redirectTo } = parseData(
      await request.formData(),
      z.object({
        assetIds: z.array(z.string()).optional().default([]),
        removedAssetIds: z.array(z.string()).optional().default([]),
        redirectTo: z.string().optional(),
      }),
      {
        additionalData: { userId, organizationId, locationId },
      }
    );

    await updateLocationAssets({
      assetIds,
      organizationId,
      locationId,
      userId,
      request,
      removedAssetIds,
    });

    /**
     * If redirectTo is in form that means user has submitted the form through alert,
     * so we have to redirect to manage-kits url
     */
    if (redirectTo) {
      return redirect(redirectTo);
    }

    return redirect(`/locations/${locationId}/assets`);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, locationId });
    return data(error(reason), { status: reason.status });
  }
}

export default function AddAssetsToLocation() {
  const { location, totalItems } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSearching = isFormProcessing(navigation.state);
  const navigate = useNavigate();
  const submit = useSubmit();

  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const selectedBulkItems = useAtomValue(selectedBulkItemsAtom);
  const updateItem = useSetAtom(setSelectedBulkItemAtom);
  const setSelectedBulkItems = useSetAtom(setSelectedBulkItemsAtom);
  const selectedBulkItemsCount = useAtomValue(selectedBulkItemsCountAtom);
  const hasSelectedAllItems = isSelectingAllItems(selectedBulkItems);

  const locationKitIds = location.kits.map((k) => k.id);
  const locationAssetsCount = location.assets.length;
  const hasUnsavedChanges = selectedBulkItemsCount !== locationAssetsCount;

  const manageKitsUrl = `/locations/${location.id}/kits/manage-kits`;

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
    <Tabs
      className="flex h-full max-h-full flex-col"
      value="assets"
      onValueChange={() => {
        if (hasUnsavedChanges) {
          setIsAlertOpen(true);
          return;
        }

        navigate(manageKitsUrl);
      }}
    >
      <div className="border-b px-6 py-2">
        <TabsList className="w-full">
          <TabsTrigger className="flex-1 gap-x-2" value="assets">
            Assets{" "}
            {selectedBulkItemsCount > 0 ? (
              <GrayBadge className="size-[20px] border border-primary-200 bg-primary-50 text-[10px] leading-[10px] text-primary-700">
                {hasSelectedAllItems ? totalItems : selectedBulkItemsCount}
              </GrayBadge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger className="flex-1 gap-x-2" value="kits">
            Kits
            {locationKitIds.length > 0 ? (
              <GrayBadge className="size-[20px] border border-primary-200 bg-primary-50 text-[10px] leading-[10px] text-primary-700">
                {locationKitIds.length}
              </GrayBadge>
            ) : null}
          </TabsTrigger>
        </TabsList>
      </div>

      <Filters
        className="justify-between !border-t-0 border-b px-6 md:flex"
        slots={{
          "left-of-search": <StatusFilter statusItems={AssetStatus} />,
          "right-of-search": (
            <SortBy
              sortingOptions={ASSET_SORTING_OPTIONS}
              defaultSortingBy="createdAt"
            />
          ),
        }}
      />

      <div className=" flex justify-around gap-2 border-b p-3 lg:gap-4">
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
              <ImageWithPreview
                thumbnailUrl={metadata.thumbnailUrl}
                alt={metadata.name}
                className="size-6 rounded-[2px]"
              />
              <div>{metadata.name}</div>
            </div>
          )}
        />
      </div>

      <TabsContent value="assets" asChild>
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
          className="mx-1 flex h-full flex-col justify-start border-0"
          bulkActions={<> </>}
          headerChildren={
            <>
              <Th>Location</Th>
              <Th>Category</Th>
              <Th>Tags</Th>
            </>
          }
        />
      </TabsContent>

      <footer className="item-center mt-auto flex shrink-0 justify-between border-t px-6 py-3">
        <p>
          {hasSelectedAllItems ? totalItems : selectedBulkItemsCount} selected
        </p>

        <div className="flex gap-3">
          <Button variant="secondary" to={".."}>
            Close
          </Button>
          <Form method="post" ref={formRef}>
            {/* We create inputs for both the removed and selected assets, so we can compare and easily add/remove */}
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
            {hasUnsavedChanges && isAlertOpen ? (
              <input name="redirectTo" value={manageKitsUrl} type="hidden" />
            ) : null}
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

      <UnsavedChangesAlert
        open={isAlertOpen}
        onOpenChange={setIsAlertOpen}
        onCancel={() => {
          navigate(manageKitsUrl);
        }}
        onYes={() => {
          submit(formRef.current);
        }}
      >
        You have added some assets to the booking but haven't saved it yet. Do
        you want to confirm adding those assets?
      </UnsavedChangesAlert>
    </Tabs>
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
            <div className="flex size-14 shrink-0 items-center justify-center">
              <AssetImage
                asset={{
                  id: item.id,
                  mainImage: item.mainImage,
                  thumbnailImage: item.thumbnailImage,
                  mainImageExpiration: item.mainImageExpiration,
                }}
                alt={`Image of ${item.title}`}
                className="size-full rounded-[4px] border object-cover"
              />
            </div>
            <div className="flex flex-col gap-y-1">
              <p className="word-break whitespace-break-spaces font-medium">
                {item.title}
              </p>
              <AssetStatusBadge
                id={item.id}
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
        <CategoryBadge category={category} />
      </Td>

      {/* Tags */}
      <Td className="text-left">
        <ListItemTagsColumn tags={tags} />
      </Td>
    </>
  );
};
