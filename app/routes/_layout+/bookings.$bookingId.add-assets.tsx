import { useEffect, useMemo, useState } from "react";
import type { Asset, Booking, Category, Custody } from "@prisma/client";
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
import { AvailabilityLabel } from "~/components/booking/availability-label";
import { AvailabilitySelect } from "~/components/booking/availability-select";
import styles from "~/components/booking/styles.css";
import { FakeCheckbox } from "~/components/forms/fake-checkbox";
import Input from "~/components/forms/input";
import { List } from "~/components/list";
import { Button } from "~/components/shared/button";

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
import { data, error, getParams, parseData } from "~/utils/http.server";
import { getClientHint } from "~/utils/client-hints";
import { makeShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.validator.server";
import { requirePermission } from "~/utils/roles.server";
import { isFormProcessing } from "~/utils/form";

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

    const booking = await getBooking({ id, organizationId });

    return json(
      data({
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
   * @TODO Going to ask here: https://github.com/pmndrs/jotai/discussions/669
   */
  useEffect(() => {
    setSelectedAssets(bookingAssetsIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking.id]);

  return (
    <div className="flex max-h-full flex-col">
      <header className="mb-3">
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

      {/* Body of the modal*/}
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
};

const RowComponent = ({ item }: { item: AssetWithBooking }) => {
  const selectedAssets = useAtomValue(bookingsSelectedAssetsAtom);
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
        <FakeCheckbox checked={checked} />
      </Td>
    </>
  );
};
