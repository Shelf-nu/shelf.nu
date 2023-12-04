import type { Asset } from "@prisma/client";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { AssetImage } from "~/components/assets/asset-image";
import { List, Filters } from "~/components/list";
import { AddAssetForm } from "~/components/location/add-asset-form";
import { Button } from "~/components/shared";
import { Td } from "~/components/table";
import { getPaginatedAndFilterableAssets } from "~/modules/asset";
import { requireAuthSession } from "~/modules/auth";
import { requireOrganisationId } from "~/modules/organization/context.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const authSession = await requireAuthSession(request);
  const { organizationId } = await requireOrganisationId(authSession, request);
  const { userId } = authSession;
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
  const booking = {
    id: 2,
    name: "Bit Summit 2024",
    status: "DRAFT",
    from: { date: "12 Jul 2024", day: "Tue", time: "10:00" },
    to: { date: "14 Jul 2024", day: "Fri", time: "20:00" },
    custodian: "Olivia Rhye",
  };
  return json({
    showModal: true,
    booking,
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
  });
};

export default function AddAssetsToNewBooking() {
  const { booking } = useLoaderData<typeof loader>();

  return (
    <div>
      <header className="mb-5">
        <h2>Move assets to ‘{booking?.name}’ booking</h2>
        <p>Fill up the booking with the assets of your choice</p>
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
        Save
      </Button>
    </div>
  );
}

type AssetWithLocation = Asset & {
  location: {
    name: string;
  };
};

const RowComponent = ({ item }: { item: AssetWithLocation }) => (
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
      <AddAssetForm assetId={item.id} isChecked={false} />
    </Td>
  </>
);
