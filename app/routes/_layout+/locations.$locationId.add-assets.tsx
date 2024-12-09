import { useEffect, useMemo } from "react";
import type { Asset } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useNavigation } from "@remix-run/react";
import { useAtom, useAtomValue } from "jotai";
import { z } from "zod";
import { locationsSelectedAssetsAtom } from "~/atoms/selected-assets-atoms";
import { AssetImage } from "~/components/assets/asset-image";
import { Form } from "~/components/custom-form";
import DynamicDropdown from "~/components/dynamic-dropdown/dynamic-dropdown";
import { FakeCheckbox } from "~/components/forms/fake-checkbox";
import { ChevronRight } from "~/components/icons/library";
import Header from "~/components/layout/header";
import { List } from "~/components/list";
import { Filters } from "~/components/list/filters";
import { Button } from "~/components/shared/button";
import { Image } from "~/components/shared/image";

import { Td } from "~/components/table";
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
import { ALL_SELECTED_KEY } from "~/utils/list";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { tw } from "~/utils/tw";

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
      excludeSearchFromView: true,
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
        showModal: true,
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
  const { location, header, items } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSearching = isFormProcessing(navigation.state);

  const locationAssetsIds = useMemo(
    () => location.assets.map((a) => a.id),
    [location.assets]
  );

  const [selectedAssets, setSelectedAssets] = useAtom(
    locationsSelectedAssetsAtom
  );
  const hasSelectedAll = selectedAssets.includes(ALL_SELECTED_KEY);

  const removedAssetIds = useMemo(
    () =>
      locationAssetsIds.filter((prevId) => !selectedAssets.includes(prevId)),
    [locationAssetsIds, selectedAssets]
  );

  function handleSelectAll() {
    if (hasSelectedAll) {
      setSelectedAssets(locationAssetsIds);
    } else {
      setSelectedAssets([
        ...locationAssetsIds,
        ...items.map((item) => item.id),
        ALL_SELECTED_KEY,
      ]);
    }
  }

  /**
   * Initially here we were using useHydrateAtoms, but we found that it was causing the selected assets to stay the same as it hydrates only once per store and we dont have different stores per location
   * So we do a manual effect to set the selected assets to the location assets ids
   */
  useEffect(() => {
    setSelectedAssets(locationAssetsIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.id]);

  return (
    <div className="flex h-full max-h-full flex-col">
      <Header
        {...header}
        hideBreadcrumbs={true}
        classNames="text-left mb-3 -mx-6 [&>div]:px-6 -mt-6"
      />

      <div className="-mx-6 border-b px-6 md:pb-3">
        <Filters className="md:border-0 md:p-0"></Filters>
      </div>
      <div className="-mx-6 flex  justify-around gap-2 border-b p-3 lg:gap-4">
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
      <div className="-mx-6  flex-1 overflow-y-auto px-5 md:px-0">
        <List
          ItemComponent={RowComponent}
          /** Clicking on the row will add the current asset to the atom of selected assets */
          navigate={(assetId) => {
            setSelectedAssets((selectedAssets) =>
              selectedAssets.includes(assetId)
                ? selectedAssets.filter((id) => id !== assetId)
                : [...selectedAssets, assetId]
            );
          }}
          customEmptyStateContent={{
            title: "You haven't added any assets yet.",
            text: "What are you waiting for? Create your first asset now!",
            newButtonRoute: "/assets/new",
            newButtonContent: "New asset",
          }}
          className="-mx-5 flex h-full flex-col justify-start border-0"
        />
      </div>
      {/* Footer of the modal */}
      <footer className="item-center -mx-6 flex justify-between border-t px-6 pt-3">
        <div className="flex items-center gap-2">
          <p>
            {hasSelectedAll ? selectedAssets.length - 1 : selectedAssets.length}{" "}
            assets selected
          </p>
          <Button
            variant="secondary"
            className="px-2 py-1 text-sm font-normal"
            onClick={handleSelectAll}
          >
            {hasSelectedAll ? "Clear all" : "Select all"}
          </Button>
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

type AssetWithLocation = Asset & {
  location: {
    name: string;
  };
};

const RowComponent = ({ item }: { item: AssetWithLocation }) => {
  const selectedAssets = useAtomValue(locationsSelectedAssetsAtom);
  const checked = selectedAssets.some((id) => id === item.id);

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
              {item.location ? (
                <div
                  className="flex items-center gap-1 text-[12px] font-medium text-gray-700"
                  title={`Current location: ${item.location.name}`}
                >
                  <div className="size-2 rounded-full bg-gray-500"></div>
                  <span>{item.location.name}</span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </Td>

      <Td>
        <FakeCheckbox
          className={tw("text-white", checked ? "text-primary" : "")}
          checked={checked}
        />
      </Td>
    </>
  );
};
