import { useEffect, useRef } from "react";
import { AssetStatus, KitStatus } from "@prisma/client";
import { json, redirect } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import { useAtomValue, useSetAtom } from "jotai";
import { AlertCircleIcon } from "lucide-react";
import { z } from "zod";
import {
  selectedBulkItemsAtom,
  selectedBulkItemsCountAtom,
  setDisabledBulkItemsAtom,
  setSelectedBulkItemAtom,
  setSelectedBulkItemsAtom,
} from "~/atoms/list";
import { AssetImage } from "~/components/assets/asset-image/component";
import { AssetStatusBadge } from "~/components/assets/asset-status-badge";
import { ListItemTagsColumn } from "~/components/assets/assets-index/assets-list";
import { ASSET_SORTING_OPTIONS } from "~/components/assets/assets-index/filters";
import { CategoryBadge } from "~/components/assets/category-badge";
import { StatusFilter } from "~/components/booking/status-filter";
import { Form } from "~/components/custom-form";
import DynamicDropdown from "~/components/dynamic-dropdown/dynamic-dropdown";
import { ChevronRight } from "~/components/icons/library";
import ImageWithPreview from "~/components/image-with-preview/image-with-preview";
import { List } from "~/components/list";
import { Filters } from "~/components/list/filters";
import { SortBy } from "~/components/list/filters/sort-by";
import type { ListItemData } from "~/components/list/list-item";
import SelectWithSearchParams from "~/components/select-with-search-params/select-with-search-params";
import { Button } from "~/components/shared/button";
import { GrayBadge } from "~/components/shared/gray-badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogTrigger,
} from "~/components/shared/modal";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/shared/tooltip";
import { Td, Th } from "~/components/table";
import When from "~/components/when/when";
import { db } from "~/database/db.server";
import { getPaginatedAndFilterableAssets } from "~/modules/asset/service.server";
import type { AssetsFromViewItem } from "~/modules/asset/types";
import { updateKitAssets } from "~/modules/kit/service.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { data, error, getParams, parseData } from "~/utils/http.server";
import { isSelectingAllItems } from "~/utils/list";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { tw } from "~/utils/tw";

type LoaderData = typeof loader;

const ASSET_KIT_FILTERS = [
  { label: "All assets", value: "ALL" },
  { label: "Not in any kit", value: "NOT_IN_KIT" },
  { label: "In other kits", value: "IN_OTHER_KITS" },
];

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { kitId } = getParams(params, z.object({ kitId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.kit,
      action: PermissionAction.update,
    });

    const [
      kit,
      {
        assets,
        totalAssets,
        categories,
        totalCategories,
        tags,
        totalTags,
        locations,
        totalLocations,
        search,
        page,
        totalPages,
        perPage,
      },
    ] = await Promise.all([
      db.kit
        .findFirstOrThrow({
          where: { id: kitId, organizationId },
          select: {
            id: true,
            name: true,
            status: true,
            location: { select: { id: true, name: true } },
            assets: { select: { id: true } },
          },
        })
        .catch((cause) => {
          throw new ShelfError({
            cause,
            title: "Kit not found!",
            message:
              "The kit you are trying to access does not exists or you do not have permission to asset it.",
            status: 404,
            label: "Kit",
          });
        }),
      getPaginatedAndFilterableAssets({
        request,
        organizationId,
      }),
    ]);

    const modelName = {
      singular: "asset",
      plural: "assets",
    };

    return json(
      data({
        header: {
          title: `Add assets for ${kit.name}`,
          subHeading: "Fill up the kit with the assets of your choice.",
        },
        searchFieldLabel: "Search assets",
        searchFieldTooltip: {
          title: "Search your asset database",
          text: "Search assets based on asset name or description, category, tag, location, custodian name. Simply separate your keywords by a space: 'Laptop lenovo 2020'.",
        },
        showSidebar: true,
        noScroll: true,
        kit,
        items: assets,
        totalItems: totalAssets,
        categories,
        tags,
        search,
        page,
        totalCategories,
        totalTags,
        locations,
        totalLocations,
        totalPages,
        perPage,
        modelName,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, kitId });
    throw json(error(reason), { status: reason.status });
  }
}

export async function action({ context, request, params }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { kitId } = getParams(params, z.object({ kitId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.kit,
      action: PermissionAction.update,
    });

    let { assetIds } = parseData(
      await request.formData(),
      z.object({
        assetIds: z.array(z.string()).optional().default([]),
      }),
      { additionalData: { userId, organizationId, kitId } }
    );

    await updateKitAssets({
      kitId,
      assetIds,
      userId,
      organizationId,
      request,
    });

    return redirect(`/kits/${kitId}/assets`);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, kitId });
    return json(error(reason), { status: reason.status });
  }
}

export default function ManageAssetsInKit() {
  const { kit, items, totalItems } = useLoaderData<LoaderData>();
  const kitAssetIds = kit.assets.map((asset) => asset.id);

  const navigation = useNavigation();
  const isSearching = isFormProcessing(navigation.state);

  const formRef = useRef<HTMLFormElement>(null);
  const submit = useSubmit();

  const selectedBulkItems = useAtomValue(selectedBulkItemsAtom);
  const updateItem = useSetAtom(setSelectedBulkItemAtom);
  const setSelectedBulkItems = useSetAtom(setSelectedBulkItemsAtom);
  const selectedBulkItemsCount = useAtomValue(selectedBulkItemsCountAtom);
  const hasSelectedAllItems = isSelectingAllItems(selectedBulkItems);
  const setDisabledBulkItems = useSetAtom(setDisabledBulkItemsAtom);

  /**
   * Set selected items for kit based on the route data
   */
  useEffect(() => {
    setSelectedBulkItems(kit.assets);
  }, [kit.assets, setSelectedBulkItems]);

  /**
   * Set disabled items for kit
   */
  useEffect(() => {
    const disabledBulkItems = items.reduce<ListItemData[]>((acc, asset) => {
      const isCheckedOut = asset.status === AssetStatus.CHECKED_OUT;
      const isInCustody = asset.status === AssetStatus.IN_CUSTODY;

      if ((isCheckedOut || isInCustody) && !kitAssetIds.includes(asset.id)) {
        acc.push(asset);
      }

      return acc;
    }, []);

    setDisabledBulkItems(disabledBulkItems);
  }, [items, kitAssetIds, setDisabledBulkItems]);

  function handleSubmit() {
    submit(formRef.current);
  }

  return (
    <div className="flex size-full flex-col overflow-y-hidden">
      <div className=" border-b px-6 md:pb-3">
        <Filters
          className="md:border-0 md:p-0"
          slots={{
            "left-of-search": <StatusFilter statusItems={AssetStatus} />,
            "right-of-search": (
              <div className="flex items-center gap-2">
                <SortBy
                  sortingOptions={ASSET_SORTING_OPTIONS}
                  defaultSortingBy="createdAt"
                />
                <SelectWithSearchParams
                  name="assetKitFilter"
                  items={ASSET_KIT_FILTERS}
                  defaultValue="ALL"
                  placeholder="Filter by kit"
                />
              </div>
            ),
          }}
        ></Filters>
      </div>
      <div className="flex justify-around gap-2 border-b p-3 lg:gap-4">
        <DynamicDropdown
          trigger={
            <div className="flex h-6 cursor-pointer items-center gap-2">
              Categories <ChevronRight className="hidden rotate-90 md:inline" />
            </div>
          }
          model={{ name: "category", queryKey: "name" }}
          label="Filter by category"
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
          label="Filter by tags"
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
          label="Filter by Location"
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
      {/* Body of the modal - this is the scrollable area */}
      <div className="flex-1 overflow-y-auto px-5 md:px-0">
        <List
          ItemComponent={RowComponent}
          navigate={(_assetId, item) => {
            const isParkOfCurrentKit = kitAssetIds.includes(item.id);

            if (
              item.status === AssetStatus.CHECKED_OUT &&
              !isParkOfCurrentKit
            ) {
              return;
            }

            if (item.status === AssetStatus.IN_CUSTODY && !isParkOfCurrentKit) {
              return;
            }

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
              <Th>Kit</Th>
              <Th>Category</Th>
              <Th>Tags</Th>
              <Th>Location</Th>
            </>
          }
          disableSelectAllItems={true}
          extraItemComponentProps={{ kitAssetIds }}
        />
      </div>
      {/* Footer of the modal - fixed at the bottom */}
      <footer className="item-center mt-auto flex shrink-0 justify-between border-t px-6 py-3">
        <p>
          {hasSelectedAllItems ? totalItems : selectedBulkItemsCount} selected
        </p>

        <div className="flex gap-3">
          <Button variant="secondary" to="..">
            Close
          </Button>
          <Form method="post" ref={formRef}>
            {selectedBulkItems.map((asset, i) => (
              <input
                key={asset.id}
                type="hidden"
                name={`assetIds[${i}]`}
                value={asset.id}
              />
            ))}

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button disabled={isSearching}>Confirm</Button>
              </AlertDialogTrigger>

              <AlertDialogContent>
                <div className="flex items-center gap-4">
                  <div className="flex size-12 items-center justify-center rounded-full bg-blue-200/20">
                    <div className="flex size-10 items-center justify-center rounded-full bg-blue-200/50">
                      <AlertCircleIcon className="size-4 text-blue-600" />
                    </div>
                  </div>

                  <h3>Add Assets to kit?</h3>
                </div>

                <div>
                  {(kit.status === KitStatus.IN_CUSTODY ||
                    kit.status === KitStatus.CHECKED_OUT) && (
                    <p className="mb-3">
                      This kit is currently{" "}
                      {kit.status === KitStatus.IN_CUSTODY
                        ? "in custody"
                        : "checked out"}
                      . Any assets you add will automatically inherit the kit's
                      status.
                    </p>
                  )}
                  {kit.location ? (
                    <p className="mb-3">
                      <strong>Location Update Notice:</strong> Adding assets to
                      this kit will automatically update their location to{" "}
                      <strong>{kit.location.name}</strong>.
                    </p>
                  ) : (
                    <p className="mb-3">
                      <strong>Location Update Notice:</strong> Adding assets to
                      this kit will remove their current location since this kit
                      has no location assigned.
                    </p>
                  )}
                  <p>Are you sure you want to continue?</p>
                </div>

                <AlertDialogFooter>
                  <AlertDialogCancel asChild>
                    <Button variant="secondary">Cancel</Button>
                  </AlertDialogCancel>

                  <AlertDialogAction asChild>
                    <Button onClick={handleSubmit}>Continue</Button>
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </Form>
        </div>
      </footer>
    </div>
  );
}

const RowComponent = ({
  item,
  extraProps: { kitAssetIds },
}: {
  item: AssetsFromViewItem;
  extraProps: { kitAssetIds: string[] };
}) => {
  const { category, tags, location } = item;
  const isCheckedOut = item.status === AssetStatus.CHECKED_OUT;
  const isInCustody = item.status === AssetStatus.IN_CUSTODY;
  const isParkOfCurrentKit = kitAssetIds.includes(item.id);

  const allowCursor =
    (isInCustody || isCheckedOut) && !isParkOfCurrentKit
      ? "cursor-not-allowed"
      : "";

  return (
    <>
      {/* Name */}
      <Td className={tw("w-full min-w-[330px] p-0 md:p-0", allowCursor)}>
        <div className="flex items-center  gap-3 p-4 md:pr-6">
          <div className="flex items-center gap-3">
            <div className="flex size-14 shrink-0 items-center justify-center">
              <AssetImage
                asset={{
                  id: item.id,
                  mainImage: item.mainImage,
                  thumbnailImage: item.thumbnailImage,
                  mainImageExpiration: item.mainImageExpiration,
                }}
                alt={item.title}
                className="size-full rounded-[4px] border object-cover"
              />
            </div>
            <div className="flex flex-col gap-y-1">
              <p className="word-break whitespace-break-spaces font-medium">
                {item.title}
              </p>

              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {/*
                   When asset is available, show normal status badge 
                   When asset is in custody, and not in other custody, show normal status badge
                */}
                <When truthy={item.status === AssetStatus.AVAILABLE}>
                  <AssetStatusBadge
                    id={item.id}
                    status={item.status}
                    availableToBook={item.availableToBook}
                  />
                </When>

                {/* When asset is in other custody, show special badge */}
                <When truthy={isInCustody}>
                  <TooltipProvider delayDuration={100}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center justify-center rounded-md border border-warning-200 bg-warning-50 px-1.5 py-0.5 text-center text-xs text-warning-700">
                          In custody
                        </div>
                      </TooltipTrigger>

                      <TooltipContent
                        side="top"
                        align="end"
                        className="md:w-80"
                      >
                        <h2 className="mb-1 text-xs font-semibold text-gray-700">
                          Asset is in custody
                        </h2>
                        <div className="text-wrap text-xs font-medium text-gray-500">
                          Asset is currently in custody of a team member. <br />{" "}
                          Make sure the asset has an Available status in order
                          to add it to this kit.
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </When>

                {/* Asset is in checked out */}
                <When truthy={isCheckedOut && !isParkOfCurrentKit}>
                  <TooltipProvider delayDuration={100}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center justify-center rounded-md border border-warning-200 bg-warning-50 px-1.5 py-0.5 text-center text-xs text-warning-700">
                          Checked out
                        </div>
                      </TooltipTrigger>

                      <TooltipContent
                        side="top"
                        align="end"
                        className="md:w-80"
                      >
                        <h2 className="mb-1 text-xs font-semibold text-gray-700">
                          Asset is checked out
                        </h2>
                        <div className="text-wrap text-xs font-medium text-gray-500">
                          Asset is currently in checked out via a booking.{" "}
                          <br /> Make sure the asset has an Available status in
                          order to add it to this kit.
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </When>
                <When truthy={isCheckedOut && isParkOfCurrentKit}>
                  <TooltipProvider delayDuration={100}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center justify-center rounded-md border border-success-200 bg-success-50 px-1.5 py-0.5 text-center text-xs text-success-700">
                          Part of kit
                        </div>
                      </TooltipTrigger>

                      <TooltipContent
                        side="top"
                        align="end"
                        className="md:w-80"
                      >
                        <h2 className="mb-1 text-xs font-semibold text-gray-700">
                          Asset is already part of this kit
                        </h2>
                        <div className="text-wrap text-xs font-medium text-gray-500">
                          Asset is currently in checked out via a booking and is
                          already part of this kit.
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </When>
              </div>
            </div>
          </div>
        </div>
      </Td>

      {/* Kit */}
      <Td className={allowCursor}>
        {item.kit?.name ? (
          <div className="flex w-max items-center justify-center rounded-full bg-gray-100 px-2 py-1 text-center text-xs font-medium">
            {item.kit.name}
          </div>
        ) : null}
      </Td>

      {/* Category */}
      <Td className={allowCursor}>
        <CategoryBadge category={category} />
      </Td>

      {/* Tags */}
      <Td className={tw("text-left", allowCursor)}>
        <ListItemTagsColumn tags={tags} />
      </Td>

      {/* Location */}
      <Td className={allowCursor}>
        {location?.name ? <GrayBadge>{location.name}</GrayBadge> : null}
      </Td>
    </>
  );
};
