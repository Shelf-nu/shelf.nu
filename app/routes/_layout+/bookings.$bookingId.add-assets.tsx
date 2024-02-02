import { useState } from "react";
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
import {
  useLoaderData,
  useNavigation,
  useSearchParams,
} from "@remix-run/react";
import { AssetImage } from "~/components/assets/asset-image";
import { AvailabilityLabel } from "~/components/booking/availability-label";
import { AvailabilitySelect } from "~/components/booking/availability-select";
import styles from "~/components/booking/styles.css";
import Input from "~/components/forms/input";
import { List } from "~/components/list";
import { AddAssetForm } from "~/components/location/add-asset-form";
import { Button } from "~/components/shared";

import { Td } from "~/components/table";
import { getPaginatedAndFilterableAssets } from "~/modules/asset";
import { getBooking, removeAssets, upsertBooking } from "~/modules/booking";
import { getRequiredParam, isFormProcessing } from "~/utils";
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
    excludeCategoriesQuery: true,
    excludeTagsQuery: true,
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
  const { booking, search } = useLoaderData<typeof loader>();
  const [_searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const isSearching = isFormProcessing(navigation.state);
  const [searchValue, setSearchValue] = useState(search || "");

  function handleSearch(value: string) {
    setSearchParams((prev) => {
      prev.set("s", value);
      return prev;
    });
  }

  function clearSearch() {
    setSearchParams((prev) => {
      prev.delete("s");
      return prev;
    });
  }

  return (
    <div>
      <header className="mb-5">
        <h2>Add assets to ‘{booking?.name}’ booking</h2>
        <p>Fill up the booking with the assets of your choice</p>
      </header>

      <div className="flex justify-between">
        <div className="flex w-1/2">
          <div className="relative flex-1">
            <Input
              type="text"
              name="s"
              label={"Search"}
              aria-label={"Search"}
              placeholder={"Search assets by name"}
              defaultValue={search || ""}
              hideLabel={true}
              hasAttachedButton
              className=" h-full flex-1"
              inputClassName="pr-9"
              onKeyUp={(e) => {
                setSearchValue(e.currentTarget.value);
                if (e.key == "Enter") {
                  e.preventDefault();
                  if (searchValue) {
                    handleSearch(searchValue);
                  }
                }
              }}
            />
            {search ? (
              <Button
                icon="x"
                variant="tertiary"
                disabled={isSearching}
                onClick={clearSearch}
                title="Clear search"
                className="absolute right-3.5 top-1/2 -translate-y-1/2 cursor-pointer border-0 p-0 text-gray-400 hover:text-gray-700"
              />
            ) : null}
          </div>

          <Button
            icon={isSearching ? "spinner" : "search"}
            type="submit"
            variant="secondary"
            title="Search"
            disabled={isSearching}
            attachToInput
            onClick={() => handleSearch(searchValue)}
          />
        </div>

        <div className="w-[200px]">
          <AvailabilitySelect />
        </div>
      </div>

      <List
        ItemComponent={RowComponent}
        className="mb-8 mt-4"
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
            <div className="flex size-12 items-center justify-center">
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
