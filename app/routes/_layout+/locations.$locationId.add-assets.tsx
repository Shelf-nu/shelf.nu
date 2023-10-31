import type { Asset } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useParams } from "@remix-run/react";
import { AssetImage } from "~/components/assets/asset-image";
import { List, Filters } from "~/components/list";
import { AddAssetForm } from "~/components/location/add-asset-form";
import { Button } from "~/components/shared";
import { Td } from "~/components/table";
import { db } from "~/database";
import {
  createLocationChangeNote,
  getPaginatedAndFilterableAssets,
} from "~/modules/asset";
import { requireAuthSession } from "~/modules/auth";
import { requireOrganisationId } from "~/modules/organization/context.server";
import { assertIsPost } from "~/utils";
import { ShelfStackError } from "~/utils/error";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const authSession = await requireAuthSession(request);
  const { organizationId } = await requireOrganisationId(authSession, request);
  const { userId } = authSession;
  const locationId = params.locationId as string;
  const location = await db.location.findUnique({
    where: {
      id: locationId,
    },
  });

  const {
    search,
    totalAssets,
    perPage,
    page,
    prev,
    next,
    categories,
    tags,
    assets,
    totalPages,
  } = await getPaginatedAndFilterableAssets({
    request,
    userId,
    organizationId,
  });

  const modelName = {
    singular: "asset",
    plural: "assets",
  };
  return json({
    showModal: true,
    items: assets,
    categories,
    tags,
    search,
    page,
    totalItems: totalAssets,
    perPage,
    totalPages,
    next,
    prev,
    modelName,
    location,
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  assertIsPost(request);
  await requireAuthSession(request);
  const { locationId } = params;
  const formData = await request.formData();
  const assetId = formData.get("assetId") as string;
  const isChecked = formData.get("isChecked") === "yes";
  const asset = await db.asset.findUnique({
    where: {
      id: assetId,
    },
    include: {
      location: true,
      user: true,
    },
  });

  const location = await db.location.update({
    where: {
      id: locationId,
    },
    data: {
      assets: isChecked
        ? { connect: { id: assetId } }
        : { disconnect: { id: assetId } },
    },
  });

  if (!location) {
    throw new ShelfStackError({ message: "Something went wrong", status: 500 });
  }

  if (asset) {
    await createLocationChangeNote({
      currentLocation: asset?.location || null,
      newLocation: location,
      firstName: asset?.user.firstName || "",
      lastName: asset?.user.lastName || "",
      assetName: asset?.title,
      assetId: asset.id,
      userId: asset?.user.id,
      isRemoving: !isChecked,
    });
  }

  return json({ ok: true });
};

export default function AddAssetsToLocation() {
  const { location } = useLoaderData<typeof loader>();

  return (
    <div>
      <header className="mb-5">
        <h2>Move assets to ‘{location?.name}’ location</h2>
        <p>
          Search your database for assets that you would like to move to this
          location.
        </p>
      </header>
      <Filters className="mb-2" />

      <List
        ItemComponent={RowComponent}
        className="mb-8"
        customEmptyStateContent={{
          title: "You haven't added any assets yet.",
          text: "What are you waiting for? Create your first asset now!",
          newButtonRoute: "/assets/new",
          newButtonContent: "New asset",
        }}
      />
      <Button variant="secondary" width="full" to={".."}>
        Done
      </Button>
    </div>
  );
}

type AssetWithLocation = Asset & {
  location: {
    name: string;
  };
};

const RowComponent = ({ item }: { item: AssetWithLocation }) => {
  const { locationId } = useParams();

  return (
    <>
      <Td className="w-full p-0 md:p-0">
        <div className="flex justify-between gap-3 p-4 md:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center">
              <AssetImage
                asset={{
                  assetId: item.id,
                  mainImage: item.mainImage,
                  mainImageExpiration: item.mainImageExpiration,
                  alt: item.title,
                }}
                className="h-full w-full rounded-[4px] border object-cover"
              />
            </div>
            <div className="flex flex-col">
              <div className="font-medium">{item.title}</div>
              {item.location ? (
                <div
                  className="flex items-center gap-1 text-[12px] font-medium text-gray-700"
                  title={`Current location: ${item.location.name}`}
                >
                  <div className="h-2 w-2 rounded-full bg-gray-500"></div>
                  <span>{item.location.name}</span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </Td>

      <Td>
        <AddAssetForm
          assetId={item.id}
          isChecked={item.locationId === locationId || false}
        />
      </Td>
    </>
  );
};
