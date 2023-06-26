import type { LoaderArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { getPaginatedAndFilterableAssets } from "~/modules/asset";
import { requireAuthSession } from "~/modules/auth";
import { Table, TableRow } from "~/components/table";
import { Asset } from "@prisma/client";
import { AssetImage } from "~/components/assets/asset-image";
import { Filters } from "~/components/list";
import { CategoryFilters } from "~/components/list/filters/category";
import { TagFilters } from "~/components/list/filters/tag";
import { Button } from "~/components/shared";
import { useAtomValue, useAtom } from "jotai";
import {
  selectedCategoriesAtom,
  clearCategoryFiltersAtom,
  selectedTagsAtom,
  clearTagFiltersAtom,
} from "~/components/list/filters/atoms";

export const loader = async ({ request }: LoaderArgs) => {
  const { userId } = await requireAuthSession(request);

  const data = await getPaginatedAndFilterableAssets({
    request,
    userId,
  });
  const modelName = {
    singular: "asset",
    plural: "assets",
  };
  return json({ showModal: true, modelName, ...data });
};

export default function AddAssetsToLocation() {
  const { assets } = useLoaderData();
  return (
    <div>
      <header className="mb-5">
        <h2>Move assets to ‘Gear Room III’ location</h2>
        <p>
          Search your database for assets that you would like to move to this
          location.
        </p>
      </header>
      <Table
        tableRows={<RowComponent items={assets} />}
        tableHeads={<TableHead />}
      />
    </div>
  );
}

interface DataObject {
  [key: string]: any;
}
const TableHead = () => {
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
    <th colSpan={2}>
      <Filters className="border-0 border-none !borber-b !border-b-solid">
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
    </th>
  );
};
const RowComponent = ({ items }: DataObject) => {
  return (
    <>
      {items.map((item: Asset) => {
        return (
          <TableRow key={item.id}>
            <td className="w-full  border-t">
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
            </td>
            <td className="border-t p-4 text-left md:px-6">
              <input type="checkbox" />
            </td>
          </TableRow>
        );
      })}
    </>
  );
};
