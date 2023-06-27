import type { Asset } from "@prisma/client";
import { List } from "~/components/list";
import type { ActionArgs, LoaderArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useParams } from "@remix-run/react";
import { useAtomValue, useAtom } from "jotai";
import { AssetImage } from "~/components/assets/asset-image";
import { Filters } from "~/components/list";
import {
  selectedCategoriesAtom,
  clearCategoryFiltersAtom,
  selectedTagsAtom,
  clearTagFiltersAtom,
} from "~/components/list/filters/atoms";
import { CategoryFilters } from "~/components/list/filters/category";
import { TagFilters } from "~/components/list/filters/tag";
import { AddAssetForm } from "~/components/location/add-asset-form";
import { Button } from "~/components/shared";
import { TableData } from "~/components/table";
import { db } from "~/database";
import { getPaginatedAndFilterableAssets } from "~/modules/asset";
import { requireAuthSession } from "~/modules/auth";
import { assertIsPost } from "~/utils";

export const loader = async ({ request }: LoaderArgs) => {
  const { userId } = await requireAuthSession(request);

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
  });
};

export const action = async ({ request, params }: ActionArgs) => {
  assertIsPost(request);
  await requireAuthSession(request);
  const { locationId } = params;
  const formData = await request.formData();
  const assetId = formData.get("assetId") as string;
  const isChecked = formData.get("isChecked") === "yes";

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
    throw new Response("Something went wrong", { status: 500 });
  }

  return json({ ok: true });
};

export default function AddAssetsToLocation() {
  const selectedCategories = useAtomValue(selectedCategoriesAtom);
  const [, clearCategoryFilters] = useAtom(clearCategoryFiltersAtom);

  const selectedTags = useAtomValue(selectedTagsAtom);
  const [, clearTagFilters] = useAtom(clearTagFiltersAtom);

  const hasFiltersToClear =
    selectedCategories.items.length > 0 || selectedTags.items.length > 0;

  const handleClearFilters = () => {
    clearCategoryFilters();
    clearTagFilters();
  };
  return (
    <div>
      <header className="mb-5">
        <h2>Move assets to ‘Gear Room III’ location</h2>
        <p>
          Search your database for assets that you would like to move to this
          location.
        </p>
      </header>
      <Filters className="mb-2">
        <div className="flex items-center justify-around gap-6 md:justify-end">
          {hasFiltersToClear ? (
            <div className="hidden gap-6 md:flex">
              <Button
                as="button"
                onClick={handleClearFilters}
                variant="link"
                className="block max-w-none font-normal  text-gray-500 hover:text-gray-600"
              >
                Clear all filters
              </Button>
              <div className="text-gray-500"> | </div>
            </div>
          ) : null}
          <CategoryFilters />
          <TagFilters />
        </div>
      </Filters>
      <List ItemComponent={RowComponent} className="mb-8" />
      <Button variant="secondary" width="full" to={".."}>
        Done
      </Button>
    </div>
  );
}

const RowComponent = ({ item }: { item: Asset }) => {
  const { locationId } = useParams();

  return (
    <>
      <TableData className="w-full p-0 md:p-0">
        <div className="flex justify-between gap-3 p-4 md:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-[4px] border">
              <AssetImage
                asset={{
                  assetId: item.id,
                  mainImage: item.mainImage,
                  mainImageExpiration: item.mainImageExpiration,
                  alt: item.title,
                }}
                className="h-10 w-10 rounded-[4px] object-cover"
              />
            </div>
            <div className="flex flex-row items-center gap-2">
              <div className="font-medium">{item.title}</div>
            </div>
          </div>
        </div>
      </TableData>

      <TableData>
        <AddAssetForm
          assetId={item.id}
          isChecked={item.locationId === locationId || false}
        />
      </TableData>
    </>
  );
};
