import { useEffect, useMemo, useRef, useState } from "react";
import type { Asset, Booking, Category, Custody, Kit } from "@prisma/client";
import { AssetStatus } from "@prisma/client";
import type {
  ActionFunctionArgs,
  LinksFunction,
  LoaderFunctionArgs,
} from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  useLoaderData,
  useNavigate,
  useNavigation,
  useSubmit,
} from "@remix-run/react";
import { useAtomValue, useSetAtom } from "jotai";
import { z } from "zod";
import {
  disabledBulkItemsAtom,
  selectedBulkItemsAtom,
  selectedBulkItemsCountAtom,
  setDisabledBulkItemsAtom,
  setSelectedBulkItemAtom,
  setSelectedBulkItemsAtom,
} from "~/atoms/list";
import { AssetImage } from "~/components/assets/asset-image/component";
import { AssetStatusBadge } from "~/components/assets/asset-status-badge";
import { AvailabilityLabel } from "~/components/booking/availability-label";
import { AvailabilitySelect } from "~/components/booking/availability-select";
import { StatusFilter } from "~/components/booking/status-filter";
import styles from "~/components/booking/styles.css?url";
import UnsavedChangesAlert from "~/components/booking/unsaved-changes-alert";
import { Form } from "~/components/custom-form";
import DynamicDropdown from "~/components/dynamic-dropdown/dynamic-dropdown";
import { ChevronRight } from "~/components/icons/library";
import { List } from "~/components/list";
import { Filters } from "~/components/list/filters";
import type { ListItemData } from "~/components/list/list-item";
import { Badge } from "~/components/shared/badge";
import { Button } from "~/components/shared/button";
import { GrayBadge } from "~/components/shared/gray-badge";
import { Image } from "~/components/shared/image";

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "~/components/shared/tabs";
import { Td, Th } from "~/components/table";

import When from "~/components/when/when";
import { db } from "~/database/db.server";
import { getPaginatedAndFilterableAssets } from "~/modules/asset/service.server";
import type { AssetsFromViewItem } from "~/modules/asset/types";
import { getAssetsWhereInput } from "~/modules/asset/utils.server";
import {
  getBooking,
  getKitIdsByAssets,
  removeAssets,
  updateBookingAssets,
} from "~/modules/booking/service.server";
import { createNotes } from "~/modules/note/service.server";
import { getUserByID } from "~/modules/user/service.server";
import { getShareAgreementUrl } from "~/utils/asset";
import { makeShelfError } from "~/utils/error";
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

export type AssetWithBooking = Asset & {
  bookings: Booking[];
  custody: Custody | null;
  category: Category;
  kitId?: string | null;
  qrScanned: string;
  kit: Pick<Kit, "id" | "name" | "status"> | null;
};

export const links: LinksFunction = () => [{ rel: "stylesheet", href: styles }];

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { bookingId: id } = getParams(
    params,
    z.object({ bookingId: z.string() }),
    {
      additionalData: { userId },
    }
  );

  try {
    const { organizationId, userOrganizations } = await requirePermission({
      userId: authSession?.userId,
      request,
      entity: PermissionEntity.booking,
      action: PermissionAction.update,
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

    const booking = await getBooking({
      id,
      organizationId,
      userOrganizations,
      request,
    });
    const bookingKitIds = getKitIdsByAssets(booking.assets);

    return json(
      data({
        header: {
          title: `Manage assets for ‘${booking?.name}’`,
          subHeading: "Fill up the booking with the assets of your choice",
        },
        searchFieldLabel: "Search assets",
        searchFieldTooltip: {
          title: "Search your asset database",
          text: "Search assets based on asset name or description, category, tag, location, custodian name. Simply separate your keywords by a space: 'Laptop lenovo 2020'.",
        },
        showSidebar: true,
        noScroll: true,
        booking,
        items: assets,
        categories,
        tags,
        search,
        page,
        totalItems: totalAssets,
        perPage,
        totalPages,
        modelName,
        totalCategories,
        totalTags,
        locations,
        totalLocations,
        bookingKitIds,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, id });
    throw json(error(reason), { status: reason.status });
  }
}

export async function action({ context, request, params }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { bookingId } = getParams(params, z.object({ bookingId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId } = await requirePermission({
      userId: authSession?.userId,
      request,
      entity: PermissionEntity.booking,
      action: PermissionAction.update,
    });

    let { assetIds, removedAssetIds, redirectTo } = parseData(
      await request.formData(),
      z.object({
        assetIds: z.array(z.string()).optional().default([]),
        removedAssetIds: z.array(z.string()).optional().default([]),
        redirectTo: z.string().optional().nullable(),
      }),
      {
        additionalData: { userId, bookingId },
      }
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
      const bookingAssets = await db.asset.findMany({
        where: {
          id: { notIn: removedAssetIds },
          bookings: { some: { id: bookingId } },
        },
        select: { id: true },
      });

      /**
       * New assets that needs to be added are
       * - Previously added assets
       * - All assets with applied filters
       */
      assetIds = [
        ...new Set([
          ...allAssets.map((asset) => asset.id),
          ...bookingAssets.map((asset) => asset.id),
        ]),
      ];
    }

    const user = await getUserByID(authSession.userId);

    /** We only update the booking if there are assets to add */
    if (assetIds.length > 0) {
      /** We update the booking with the new assets */
      const b = await updateBookingAssets({
        id: bookingId,
        organizationId,
        assetIds,
      });

      /** We create notes for the assets that were added */
      await createNotes({
        content: `**${user?.firstName?.trim()} ${user?.lastName?.trim()}** added asset to booking **[${
          b.name
        }](/bookings/${b.id})**.`,
        type: "UPDATE",
        userId: authSession.userId,
        assetIds,
      });
    }

    /** If some assets were removed, we also need to handle those */
    if (removedAssetIds.length > 0) {
      await removeAssets({
        booking: { id: bookingId, assetIds: removedAssetIds },
        firstName: user?.firstName || "",
        lastName: user?.lastName || "",
        userId: authSession.userId,
        organizationId,
      });
    }

    /**
     * If redirectTo is in form that means user has submitted the form through alert,
     * so we have to redirect to add-kits url
     */
    if (redirectTo) {
      return redirect(redirectTo);
    }

    return redirect(`/bookings/${bookingId}`);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, bookingId });
    return json(error(reason), { status: reason.status });
  }
}

export default function AddAssetsToNewBooking() {
  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const { booking, bookingKitIds, items, totalItems } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const isSearching = isFormProcessing(navigation.state);
  const submit = useSubmit();

  const selectedBulkItems = useAtomValue(selectedBulkItemsAtom);
  const updateItem = useSetAtom(setSelectedBulkItemAtom);
  const setSelectedBulkItems = useSetAtom(setSelectedBulkItemsAtom);
  const selectedBulkItemsCount = useAtomValue(selectedBulkItemsCountAtom);
  const hasSelectedAllItems = isSelectingAllItems(selectedBulkItems);
  const disabledBulkItems = useAtomValue(disabledBulkItemsAtom);
  const setDisabledBulkItems = useSetAtom(setDisabledBulkItemsAtom);

  /** Assets with kits has to be handled from manage-kits */
  const bookingAssets = useMemo(
    () => booking.assets.filter((asset) => !asset.kitId),
    [booking.assets]
  );

  const removedAssets = useMemo(
    () =>
      bookingAssets.filter(
        (asset) =>
          !selectedBulkItems.some(
            (selectedItem) => selectedItem.id === asset.id
          )
      ),
    [bookingAssets, selectedBulkItems]
  );

  const hasUnsavedChanges = selectedBulkItemsCount !== bookingAssets.length;

  const manageKitsUrl = useMemo(
    () =>
      `/bookings/${booking.id}/add-kits?${new URLSearchParams({
        // We force the as String because we know that the booking.from and booking.to are strings and exist at this point.
        // This button wouldnt be available at all if there is no booking.from and booking.to
        bookingFrom: new Date(booking.from as string).toISOString(),
        bookingTo: new Date(booking.to as string).toISOString(),
        hideUnavailable: "true",
        unhideAssetsBookigIds: booking.id,
      })}`,
    [booking]
  );

  /**
   * Set selected items for kit based on the route data
   */
  useEffect(function updateDefaultSelectedItems() {
    /**
     * We are setting the default items here, so we do not have to
     * set the assets again if there are any items already present
     */
    if (!selectedBulkItems.length) {
      setSelectedBulkItems(bookingAssets);
    }
    // We only need to run this when component mounts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Set disabled items for kit
   */
  useEffect(() => {
    const _disabledBulkItems = items.reduce<ListItemData[]>((acc, asset) => {
      if (!asset.availableToBook || !!asset.kitId) {
        acc.push(asset);
      }

      return acc;
    }, []);

    setDisabledBulkItems(_disabledBulkItems);
  }, [items, setDisabledBulkItems]);

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
            {bookingKitIds.length > 0 ? (
              <GrayBadge className="size-[20px] border border-primary-200 bg-primary-50 text-[10px] leading-[10px] text-primary-700">
                {bookingKitIds.length}
              </GrayBadge>
            ) : null}
          </TabsTrigger>
        </TabsList>
      </div>

      <Filters
        slots={{
          "left-of-search": <StatusFilter statusItems={AssetStatus} />,
          "right-of-search": <AvailabilitySelect />,
        }}
        className="justify-between !border-t-0 border-b px-6 md:flex"
      />

      <div className="flex justify-around gap-2 border-b p-3 lg:gap-4">
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

      <TabsContent value="assets" asChild>
        <List
          className="mx-0 mt-0 h-full border-0 "
          ItemComponent={RowComponent}
          /** Clicking on the row will add the current asset to the atom of selected assets */
          navigate={(_assetId, asset) => {
            /** Only allow user to select if the asset is available */
            if (disabledBulkItems.some((item) => item.id === asset.id)) {
              return;
            }

            updateItem(asset);
          }}
          emptyStateClassName="py-10"
          customEmptyStateContent={{
            title: "You haven't added any assets yet.",
            text: "What are you waiting for? Create your first asset now!",
            newButtonRoute: "/assets/new",
            newButtonContent: "New asset",
          }}
          bulkActions={<> </>}
          disableSelectAllItems
          headerChildren={
            <>
              <Th>Id</Th>
              <Th>Category</Th>
              <Th>Tags</Th>
              <Th>Location</Th>
            </>
          }
        />
      </TabsContent>

      {/* Footer of the modal */}
      <footer className="item-center mt-auto flex shrink-0 justify-between border-t px-6 py-3">
        <p>
          {hasSelectedAllItems ? totalItems : selectedBulkItemsCount} assets
          selected
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
        type="assets"
        open={isAlertOpen}
        onOpenChange={setIsAlertOpen}
        onCancel={() => {
          navigate(manageKitsUrl);
        }}
        onYes={() => {
          submit(formRef.current);
        }}
      />
    </Tabs>
  );
}

const RowComponent = ({ item }: { item: AssetsFromViewItem }) => {
  const selectedBulkItems = useAtomValue(selectedBulkItemsAtom);
  const checked = selectedBulkItems.some((asset) => asset.id === item.id);
  const { category, tags, location } = item;
  const isPartOfKit = !!item.kitId;
  const isAddedThroughKit = isPartOfKit && checked;

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
                alt={item.title}
                className="size-full rounded-[4px] border object-cover"
              />
            </div>
            <div className="flex flex-col gap-y-1">
              <p className="word-break whitespace-break-spaces font-medium">
                {item.title}{" "}
              </p>
              <div className="flex flex-row gap-x-2">
                <When truthy={item.status === AssetStatus.AVAILABLE}>
                  <AssetStatusBadge
                    kit={item?.kit}
                    status={item.status}
                    availableToBook={item.availableToBook}
                    shareAgreementUrl={getShareAgreementUrl(item)}
                  />
                </When>

                <AvailabilityLabel
                  isAddedThroughKit={isAddedThroughKit}
                  showKitStatus
                  asset={item as unknown as AssetWithBooking}
                  isCheckedOut={item.status === AssetStatus.CHECKED_OUT}
                />
              </div>
            </div>
          </div>
        </div>
      </Td>

      {/* ID */}
      <Td>{item.id}</Td>

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

      {/* Location */}
      <Td>{location?.name ? <GrayBadge>{location.name}</GrayBadge> : null}</Td>
    </>
  );
};
