import { useEffect, useMemo } from "react";
import {
  type Asset,
  type Booking,
  type Category,
  type Custody,
} from "@prisma/client";
import type {
  ActionFunctionArgs,
  LinksFunction,
  LoaderFunctionArgs,
} from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Form,
  useLoaderData,
  useNavigation,
  useSearchParams,
} from "@remix-run/react";
import { useAtom, useAtomValue } from "jotai";
import { z } from "zod";
import { bookingsSelectedAssetsAtom } from "~/atoms/selected-assets-atoms";
import { AssetImage } from "~/components/assets/asset-image";
import GroupedByKitAssets from "~/components/assets/grouped-by-kit-assets";
import { AvailabilityLabel } from "~/components/booking/availability-label";
import { AvailabilitySelect } from "~/components/booking/availability-select";
import styles from "~/components/booking/styles.css?url";
import DynamicDropdown from "~/components/dynamic-dropdown/dynamic-dropdown";
import { FakeCheckbox } from "~/components/forms/fake-checkbox";
import { ChevronRight } from "~/components/icons/library";
import Header from "~/components/layout/header";
import { List } from "~/components/list";
import { Filters } from "~/components/list/filters";
import { Button } from "~/components/shared/button";
import { Image } from "~/components/shared/image";

import { Spinner } from "~/components/shared/spinner";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "~/components/shared/tabs";
import { Td } from "~/components/table";

import {
  createNotes,
  getPaginatedAndFilterableAssets,
} from "~/modules/asset/service.server";
import {
  getBooking,
  removeAssets,
  upsertBooking,
} from "~/modules/booking/service.server";
import { getUserByID } from "~/modules/user/service.server";
import { getClientHint } from "~/utils/client-hints";
import { makeShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import {
  data,
  error,
  getCurrentSearchParams,
  getParams,
  parseData,
} from "~/utils/http.server";
import { getParamsValues } from "~/utils/list";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.validator.server";
import { requirePermission } from "~/utils/roles.server";
import { tw } from "~/utils/tw";

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
    const { organizationId } = await requirePermission({
      userId: authSession?.userId,
      request,
      entity: PermissionEntity.booking,
      action: PermissionAction.update,
    });

    const searchParams = getCurrentSearchParams(request);
    const paramsValues = getParamsValues(searchParams);

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
      bookingTab: paramsValues.tab ? paramsValues.tab : "assets",
    });

    const modelName = {
      singular: "asset",
      plural: "assets",
    };

    const booking = await getBooking({ id, organizationId });

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
        showModal: true,
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
    await requirePermission({
      userId: authSession?.userId,
      request,
      entity: PermissionEntity.booking,
      action: PermissionAction.update,
    });

    // assetIds: z.array(z.string()).optional().default([]),
    // removedAssetIds: z.array(z.string()).optional().default([]),

    const { assetIds, removedAssetIds } = parseData(
      await request.formData(),
      z.object({
        assetIds: z.array(z.string()).optional().default([]),
        removedAssetIds: z.array(z.string()).optional().default([]),
      }),
      {
        additionalData: { userId, bookingId },
      }
    );

    const user = await getUserByID(authSession.userId);

    /** We only update the booking if there are assets to add */
    if (assetIds.length > 0) {
      /** We update the booking with the new assets */
      const b = await upsertBooking(
        {
          id: bookingId,
          assetIds,
        },
        getClientHint(request)
      );

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
      });
    }

    return redirect(`/bookings/${bookingId}`);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, bookingId });
    return json(error(reason), { status: reason.status });
  }
}

export default function AddAssetsToNewBooking() {
  const { booking, header } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const isSearching = isFormProcessing(navigation.state);

  const selectedTab = searchParams.get("tab") ?? "assets";

  const bookingAssetsIds = useMemo(
    () => booking?.assets.map((a) => a.id) || [],
    [booking.assets]
  );

  const [selectedAssets, setSelectedAssets] = useAtom(
    bookingsSelectedAssetsAtom
  );
  const removedAssetIds = useMemo(
    () => bookingAssetsIds.filter((prevId) => !selectedAssets.includes(prevId)),
    [bookingAssetsIds, selectedAssets]
  );

  /**
   * Initially here we were using useHydrateAtoms, but we found that it was causing the selected assets to stay the same as it hydrates only once per store and we dont have different stores per booking
   * So we do a manual effect to set the selected assets to the booking assets ids
   * I would still rather use the useHydrateAtoms, but it's not working as expected.
   *  https://github.com/pmndrs/jotai/discussions/669
   */
  useEffect(() => {
    setSelectedAssets(bookingAssetsIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking.id]);

  return (
    <div className="flex flex-col">
      <Header
        {...header}
        hideBreadcrumbs={true}
        classNames="text-left -mx-6 [&>div]:px-6 -mt-6"
      />

      <Tabs
        value={selectedTab}
        className="-mx-6 flex-1 py-2"
        onValueChange={(value) => {
          setSearchParams((prev) => {
            prev.set("tab", value);
            return prev;
          });
        }}
      >
        <div className="border-b px-6 pb-2">
          <TabsList className="w-full">
            <TabsTrigger className="flex-1" value="assets">
              Assets
            </TabsTrigger>
            <TabsTrigger className="flex-1" value="kits">
              Kits
            </TabsTrigger>
          </TabsList>
        </div>

        <Filters
          slots={{
            "right-of-search": <AvailabilitySelect />,
          }}
          className="justify-between !border-t-0 border-b px-6 md:flex"
        />

        <div className="flex justify-around gap-2 border-b p-3 lg:gap-4">
          <DynamicDropdown
            trigger={
              <div className="flex h-6 cursor-pointer items-center gap-2">
                Categories{" "}
                <ChevronRight className="hidden rotate-90 md:inline" />
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
                Locations{" "}
                <ChevronRight className="hidden rotate-90 md:inline" />
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

        {/* Body of the modal*/}
        <TabsContent
          className="flex-1 overflow-y-auto px-5 md:px-0"
          value="assets"
        >
          {isSearching ? (
            <div className="flex h-[400px] flex-1 items-center justify-center">
              <Spinner />
            </div>
          ) : (
            <List
              ItemComponent={RowComponent}
              /** Clicking on the row will add the current asset to the atom of selected assets */
              navigate={(assetId, asset) => {
                /** Only allow user to select if the asset is available */
                if (!asset.availableToBook || !!asset.kitId) {
                  return;
                }

                setSelectedAssets((selectedAssets) =>
                  selectedAssets.includes(assetId)
                    ? selectedAssets.filter((id) => id !== assetId)
                    : [...selectedAssets, assetId]
                );
              }}
              emptyStateClassName="py-10"
              customEmptyStateContent={{
                title: "You haven't added any assets yet.",
                text: "What are you waiting for? Create your first asset now!",
                newButtonRoute: "/assets/new",
                newButtonContent: "New asset",
              }}
              className="-mx-5 flex h-full flex-col justify-between border-0"
            />
          )}
        </TabsContent>
        <TabsContent
          value="kits"
          className="mt-0 flex-1 overflow-y-auto px-5 md:px-0 "
        >
          <GroupedByKitAssets />
        </TabsContent>
      </Tabs>

      {/* Footer of the modal */}
      <footer className="item-center -mx-6 flex justify-between border-t px-6 pt-3">
        <div className="flex items-center">
          {selectedAssets.length} assets selected
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" to={".."}>
            Close
          </Button>
          <Form method="post">
            {/* We create inputs for both the removed and selected assets, so we can compare and easily add/remove */}
            {/* These are the asset ids, coming from the server */}
            {removedAssetIds.map((assetId, i) => (
              <input
                key={assetId}
                type="hidden"
                name={`removedAssetIds[${i}]`}
                value={assetId}
              />
            ))}
            {/* These are the ids selected by the user and stored in the atom */}
            {selectedAssets.map((assetId, i) => (
              <input
                key={assetId}
                type="hidden"
                name={`assetIds[${i}]`}
                value={assetId}
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

export type AssetWithBooking = Asset & {
  bookings: Booking[];
  custody: Custody | null;
  category: Category;
  kitId?: string | null;
};

const RowComponent = ({ item }: { item: AssetWithBooking }) => {
  const selectedAssets = useAtomValue(bookingsSelectedAssetsAtom);
  const checked = selectedAssets.some((id) => id === item.id);

  const isPartOfKit = !!item.kitId;

  return (
    <>
      <Td className="w-full p-0 md:p-0">
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
            <div className="flex flex-col">
              <p className="word-break whitespace-break-spaces font-medium">
                {item.title}
              </p>
            </div>
          </div>
        </div>
      </Td>

      <Td className="text-right">
        <AvailabilityLabel
          showKitStatus
          asset={item}
          isCheckedOut={item.status === "CHECKED_OUT"}
        />
      </Td>

      <Td>
        <FakeCheckbox
          className={tw("text-white", isPartOfKit ? "text-gray-100" : "")}
          checked={checked}
          aria-disabled={isPartOfKit}
        />
      </Td>
    </>
  );
};
