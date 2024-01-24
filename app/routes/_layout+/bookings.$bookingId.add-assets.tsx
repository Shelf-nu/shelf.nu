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
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { AssetImage } from "~/components/assets/asset-image";
import { AvailabilityLabel } from "~/components/booking/availability-label";
import { AvailabilitySelect } from "~/components/booking/availability-select";
import styles from "~/components/booking/styles.css";
import { List } from "~/components/list";
import { AddAssetForm } from "~/components/location/add-asset-form";
import { Button } from "~/components/shared";

import { Td } from "~/components/table";
import { getPaginatedAndFilterableAssets } from "~/modules/asset";
import { getBooking, removeAssets, upsertBooking } from "~/modules/booking";
import { getRequiredParam } from "~/utils";
import { getClientHint } from "~/utils/client-hints";
import { ShelfStackError } from "~/utils/error";
import { PermissionAction, PermissionEntity } from "~/utils/permissions";
import { requirePermision } from "~/utils/roles.server";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: styles }];

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { organizationId } = await requirePermision(
    request,
    PermissionEntity.booking,
    PermissionAction.update
  );
  const id = getRequiredParam(params, "bookingId");
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
    organizationId,
  });

  const modelName = {
    singular: "asset",
    plural: "assets",
  };
  const booking = await getBooking({ id });
  if (!booking) {
    throw new ShelfStackError({ message: "Booking not found" });
  }

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

export const action = async ({ request, params }: ActionFunctionArgs) => {
  await requirePermision(
    request,
    PermissionEntity.booking,
    PermissionAction.update
  );

  const bookingId = getRequiredParam(params, "bookingId");
  const formData = await request.formData();
  const assetId = formData.get("assetId") as string;
  const isChecked = formData.get("isChecked") === "yes";
  if (isChecked) {
    await upsertBooking(
      {
        id: bookingId,
        assetIds: [assetId],
      },
      getClientHint(request)
    );
  } else {
    await removeAssets({
      id: bookingId,
      assetIds: [assetId],
    });
  }

  return json({ ok: true });
};

export default function AddAssetsToNewBooking() {
  const { booking } = useLoaderData<typeof loader>();
  return (
    <div>
      <header className="mb-5">
        <h2>Move assets to ‘{booking?.name}’ booking</h2>
        <p>Fill up the booking with the assets of your choice</p>
      </header>
      {/**
       * @TODO the search is not working properly its completely cracked.
       * We have to rework it with new strategy using useSearchParams
       */}
      {/* <Filters></Filters> */}

      <div className="mb-2">
        <AvailabilitySelect />
      </div>
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
        Close
      </Button>
    </div>
  );
}

export type AssetWithBooking = Asset & {
  bookings: Booking[];
  custody: Custody | null;
  category: Category;
};

const RowComponent = ({ item }: { item: AssetWithBooking }) => {
  const { booking } = useLoaderData<typeof loader>();
  const isChecked =
    booking?.assets.some((asset) => asset.id === item.id) ?? false;

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
            </div>
          </div>
        </div>
      </Td>

      <Td className="text-right">
        <AvailabilityLabel
          asset={item}
          isCheckedOut={item.status === "CHECKED_OUT"}
        />
      </Td>

      <Td>
        <AddAssetForm assetId={item.id} isChecked={isChecked} />
      </Td>
    </>
  );
};
