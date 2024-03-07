import { useEffect, useMemo } from "react";
import type { Asset } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData, useNavigation } from "@remix-run/react";
import { useAtom, useAtomValue } from "jotai";
import { locationsSelectedAssetsAtom } from "~/atoms/selected-assets-atoms";
import { AssetImage } from "~/components/assets/asset-image";
import { FakeCheckbox } from "~/components/forms/fake-checkbox";
import { List, Filters } from "~/components/list";
import { Button } from "~/components/shared";
import { Td } from "~/components/table";
import { db } from "~/database";
import {
  createBulkLocationChangeNotes,
  getPaginatedAndFilterableAssets,
} from "~/modules/asset";

import { isFormProcessing } from "~/utils";
import { ShelfStackError } from "~/utils/error";
import { PermissionAction, PermissionEntity } from "~/utils/permissions";
import { requirePermision } from "~/utils/roles.server";

export const loader = async ({
  context,
  request,
  params,
}: LoaderFunctionArgs) => {
  const authSession = await context.getSession();
  const { organizationId } = await requirePermision({
    userId: authSession.userId,
    request,
    entity: PermissionEntity.location,
    action: PermissionAction.update,
  });
  const locationId = params.locationId as string;
  const location = await db.location.findUnique({
    where: {
      id: locationId,
      organizationId,
    },
    include: {
      assets: {
        select: { id: true },
      },
    },
  });
  if (!location) {
    throw new ShelfStackError({
      message: "Location not found",
      status: 404,
    });
  }

  const {
    search,
    totalAssets,
    perPage,
    page,
    categories,
    tags,
    assets,
    totalPages,
  } = await getPaginatedAndFilterableAssets({
    request,
    organizationId,
    excludeCategoriesQuery: true,
    excludeTagsQuery: true,
    excludeSearchFromView: true,
  });

  const modelName = {
    singular: "asset",
    plural: "assets",
  };
  return json({
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
  });
};

export const action = async ({
  context,
  request,
  params,
}: ActionFunctionArgs) => {
  const authSession = await context.getSession();
  const { organizationId } = await requirePermision({
    userId: authSession.userId,
    request,
    entity: PermissionEntity.location,
    action: PermissionAction.update,
  });
  const { locationId } = params;
  const formData = await request.formData();
  const assetIds = formData.getAll("assetId") as string[];
  const removedAssetIds = formData.getAll("removedAssetId") as string[];

  const location = await db.location.findUnique({
    where: {
      id: locationId,
      organizationId,
    },
    include: {
      assets: true,
    },
  });
  if (!location) {
    throw new ShelfStackError({
      message: "Location not found",
      status: 404,
    });
  }

  /**
   * We need to query all the modified assets so we know their location before the change
   * That way we can later create notes for all the location changes
   */
  const modifiedAssets = await db.asset.findMany({
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
  });

  if (assetIds.length > 0) {
    /** We update the location with the new assets */
    await db.location.update({
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
    });
  }

  /** If some assets were removed, we also need to handle those */
  if (removedAssetIds.length > 0) {
    await db.location.update({
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
    });
  }

  /** Creates the relevant notes for all the changed assets */
  createBulkLocationChangeNotes({
    modifiedAssets,
    assetIds,
    removedAssetIds,
    userId: authSession.userId,
    location,
  });

  return redirect(`/locations/${locationId}`);
};

export default function AddAssetsToLocation() {
  const { location } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSearching = isFormProcessing(navigation.state);

  const locationAssetsIds = useMemo(
    () => location.assets.map((a) => a.id),
    [location.assets]
  );

  const [selectedAssets, setSelectedAssets] = useAtom(
    locationsSelectedAssetsAtom
  );
  const removedAssetIds = useMemo(
    () =>
      locationAssetsIds.filter((prevId) => !selectedAssets.includes(prevId)),
    [locationAssetsIds, selectedAssets]
  );

  /**
   * Initially here we were using useHydrateAtoms, but we found that it was causing the selected assets to stay the same as it hydrates only once per store and we dont have different stores per location
   * So we do a manual effect to set the selected assets to the location assets ids
   */
  useEffect(() => {
    setSelectedAssets(locationAssetsIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.id]);

  return (
    <div className="flex max-h-full flex-col">
      <header className="mb-5">
        <h2>Move assets to ‘{location?.name}’ location</h2>
        <p>
          Search your database for assets that you would like to move to this
          location.
        </p>
      </header>

      <div>
        <Filters className="mb-2" />
      </div>
      <div className="mt-4 flex-1 overflow-y-auto pb-4">
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
        />
      </div>
      {/* Footer of the modal */}
      <footer className="flex justify-between border-t pt-3">
        <div>{selectedAssets.length} assets selected</div>
        <div className="flex gap-3">
          <Button variant="secondary" to={".."}>
            Close
          </Button>
          <Form method="post">
            {/* We create inputs for both the removed and selected assets, so we can compare and easily add/remove */}
            {/* These are the asset ids, coming from the server */}
            {removedAssetIds.map((assetId) => (
              <input
                key={assetId}
                type="hidden"
                name="removedAssetId"
                value={assetId}
              />
            ))}
            {/* These are the ids selected by the user and stored in the atom */}
            {selectedAssets.map((assetId) => (
              <input
                key={assetId}
                type="hidden"
                name="assetId"
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
        <FakeCheckbox checked={checked} />
      </Td>
    </>
  );
};
