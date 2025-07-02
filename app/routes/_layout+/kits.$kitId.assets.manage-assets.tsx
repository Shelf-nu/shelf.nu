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
import { getAssetsWhereInput } from "~/modules/asset/utils.server";
import { createBulkKitChangeNotes } from "~/modules/note/service.server";
import { getUserByID } from "~/modules/user/service.server";
import { getShareAgreementUrl } from "~/utils/asset";
import { makeShelfError, ShelfError } from "~/utils/error";
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
import { resolveTeamMemberName } from "~/utils/user";

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
          where: { id: kitId },
          select: {
            id: true,
            name: true,
            status: true,
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
          title: `Manage assets for ${kit.name}`,
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

    const user = await getUserByID(userId);

    const kit = await db.kit
      .findUniqueOrThrow({
        where: { id: kitId, organizationId },
        include: {
          assets: {
            select: {
              id: true,
              title: true,
              kit: true,
              bookings: { select: { id: true, status: true } },
            },
          },
          custody: {
            select: {
              custodian: {
                select: {
                  id: true,
                  name: true,
                  user: {
                    select: {
                      email: true,
                      firstName: true,
                      lastName: true,
                      profilePicture: true,
                    },
                  },
                },
              },
            },
          },
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message: "Kit not found",
          additionalData: { kitId, userId, organizationId },
          status: 404,
          label: "Kit",
        });
      });

    const removedAssets = kit.assets.filter(
      (asset) => !assetIds.includes(asset.id)
    );

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
      const kitAssets = kit.assets.map((asset) => asset.id);
      const removedAssetsIds = removedAssets.map((asset) => asset.id);

      /**
       * New assets that needs to be added are
       * - Previously added assets
       * - All assets with applied filters
       */
      assetIds = [
        ...new Set([
          ...allAssets.map((asset) => asset.id),
          ...kitAssets.filter((asset) => !removedAssetsIds.includes(asset)),
        ]),
      ];
    }

    const newlyAddedAssets = await db.asset
      .findMany({
        where: { id: { in: assetIds } },
        select: { id: true, title: true, kit: true, custody: true },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message:
            "Something went wrong while fetching the assets. Please try again or contact support.",
          additionalData: { assetIds, userId, kitId },
          label: "Assets",
        });
      });

    /** An asset already in custody cannot be added to a kit */
    const isSomeAssetInCustody = newlyAddedAssets.some(
      (asset) => asset.custody && asset.kit?.id !== kit.id
    );
    if (isSomeAssetInCustody) {
      throw new ShelfError({
        cause: null,
        message: "Cannot add unavailable asset in a kit.",
        additionalData: { userId, kitId },
        label: "Kit",
        shouldBeCaptured: false,
      });
    }

    const kitBookings =
      kit.assets.find((a) => a.bookings.length > 0)?.bookings ?? [];

    await db.kit.update({
      where: { id: kit.id, organizationId },
      data: {
        assets: {
          /**
           * set: [] will make sure that if any previously selected asset is removed,
           * then it is also disconnected from the kit
           */
          set: [],
          /**
           * Then this will update the assets to be whatever user has selected now
           */
          connect: newlyAddedAssets.map(({ id }) => ({ id })),
        },
      },
    });

    await createBulkKitChangeNotes({
      kit,
      newlyAddedAssets,
      removedAssets,
      userId,
    });

    /**
     * If a kit is in custody then the assets added to kit will also inherit the status
     */
    const assetsToInheritStatus = newlyAddedAssets.filter(
      (asset) => !asset.custody
    );
    if (
      kit.custody &&
      kit.custody.custodian.id &&
      assetsToInheritStatus.length > 0
    ) {
      await Promise.all([
        ...assetsToInheritStatus.map((asset) =>
          db.asset.update({
            where: { id: asset.id },
            data: {
              status: AssetStatus.IN_CUSTODY,
              custody: {
                create: {
                  custodian: { connect: { id: kit.custody?.custodian.id } },
                },
              },
            },
          })
        ),
        db.note.createMany({
          data: assetsToInheritStatus.map((asset) => ({
            content: `**${user.firstName?.trim()} ${user.lastName?.trim()}** has given **${resolveTeamMemberName(
              (kit.custody as NonNullable<typeof kit.custody>).custodian
            )}** custody over **${asset.title.trim()}**`,
            type: "UPDATE",
            userId,
            assetId: asset.id,
          })),
        }),
      ]);
    }

    /**
     * If a kit is in custody and some assets are removed,
     * then we have to make the removed assets Available
     */
    if (removedAssets.length && kit.custody?.custodian.id) {
      await Promise.all([
        db.custody.deleteMany({
          where: { assetId: { in: removedAssets.map((a) => a.id) } },
        }),
        db.asset.updateMany({
          where: { id: { in: removedAssets.map((a) => a.id) } },
          data: { status: AssetStatus.AVAILABLE },
        }),
        db.note.createMany({
          data: removedAssets.map((asset) => ({
            content: `**${user.firstName?.trim()} ${user.lastName?.trim()}** has released **${resolveTeamMemberName(
              (kit.custody as NonNullable<typeof kit.custody>).custodian
            )}'s** custody over **${asset.title.trim()}**`,
            type: "UPDATE",
            userId,
            assetId: asset.id,
          })),
        }),
      ]);
    }

    /**
     * If user is adding/removing an asset to a kit which is a part of DRAFT, RESERVED, ONGOING or OVERDUE booking,
     * then we have to add or remove these assets to booking also
     */
    const bookingsToUpdate = kitBookings.filter(
      (b) =>
        b.status === "DRAFT" ||
        b.status === "RESERVED" ||
        b.status === "ONGOING" ||
        b.status === "OVERDUE"
    );

    if (bookingsToUpdate?.length) {
      await Promise.all(
        bookingsToUpdate.map((booking) =>
          db.booking.update({
            where: { id: booking.id },
            data: {
              assets: {
                connect: newlyAddedAssets.map((a) => ({ id: a.id })),
                disconnect: removedAssets.map((a) => ({ id: a.id })),
              },
            },
          })
        )
      );
    }

    /**
     * If the kit is part of an ONGOING booking, then we have to make all
     * the assets CHECKED_OUT
     */
    if (kit.status === KitStatus.CHECKED_OUT) {
      await db.asset.updateMany({
        where: { id: { in: newlyAddedAssets.map((a) => a.id) } },
        data: { status: AssetStatus.CHECKED_OUT },
      });
    }

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

      /**
       * If the asset is checked out or in custody and not part of the current kit,
       * then we need to disable it
       */
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

            {kit.status === KitStatus.IN_CUSTODY ||
            kit.status === KitStatus.CHECKED_OUT ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button disabled={isSearching}>Confirm</Button>
                </AlertDialogTrigger>

                <AlertDialogContent>
                  <div className="flex items-center gap-4">
                    <div className="flex size-12 items-center justify-center rounded-full bg-red-200/20">
                      <div className="flex size-10 items-center justify-center rounded-full bg-red-200/50">
                        <AlertCircleIcon className="size-4 text-error-500" />
                      </div>
                    </div>

                    <h3>Add Assets to kit?</h3>
                  </div>

                  <p>
                    This kit is currently{" "}
                    {kit.status === KitStatus.IN_CUSTODY
                      ? "in custody"
                      : "checked out"}
                    . Any assets you add will automatically inherit the kit's
                    status. Are you sure you want to continue?
                  </p>

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
            ) : (
              <Button
                type="submit"
                name="intent"
                value="addAssets"
                disabled={isSearching}
              >
                Confirm
              </Button>
            )}
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
                    kit={item?.kit}
                    status={item.status}
                    availableToBook={item.availableToBook}
                    shareAgreementUrl={getShareAgreementUrl(item)}
                  />
                </When>

                {/* When asset is in other custody, show special badge */}
                <When truthy={item.status === AssetStatus.IN_CUSTODY}>
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

                {/* Asset is signature pending */}
                <When truthy={item.status === AssetStatus.SIGNATURE_PENDING}>
                  <TooltipProvider delayDuration={100}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center justify-center rounded-md border border-warning-200 bg-warning-50 px-1.5 py-0.5 text-center text-xs text-warning-700">
                          Signature pending
                        </div>
                      </TooltipTrigger>

                      <TooltipContent
                        side="top"
                        align="end"
                        className="md:w-80"
                      >
                        <h2 className="mb-1 text-xs font-semibold text-gray-700">
                          Asset has a pending signature
                        </h2>
                        <div className="text-wrap text-xs font-medium text-gray-500">
                          Assets with a pending signature are in the process of
                          being assigned to a team member. <br /> Make sure the
                          asset has an Available status in order to add it to
                          this kit.
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
