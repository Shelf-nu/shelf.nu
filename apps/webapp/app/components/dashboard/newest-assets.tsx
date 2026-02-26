import type { Asset, Category } from "@prisma/client";
import { useLoaderData } from "react-router";
import type { loader } from "~/routes/_layout+/home";
import { ClickableTr } from "./clickable-tr";
import { DashboardEmptyState } from "./empty-state";
import { AssetImage } from "../assets/asset-image/component";
import { AssetStatusBadge } from "../assets/asset-status-badge";
import { CategoryBadge } from "../assets/category-badge";
import { Button } from "../shared/button";

import { Td, Table, Tr } from "../table";

export default function NewestAssets() {
  const { newAssets } = useLoaderData<typeof loader>();
  return (
    <div className="flex h-full flex-col rounded border border-color-200 bg-surface">
      <div className="flex items-center justify-between border-b px-4 py-3 md:px-6">
        <span className="text-[14px] font-semibold text-color-900">
          Newest assets
        </span>
        <div className="flex items-center gap-2">
          <Button
            to="/assets"
            variant="block-link-gray"
            className="!mt-0 text-xs"
          >
            View all
          </Button>
        </div>
      </div>
      {newAssets.length > 0 ? (
        <Table className="flex-1">
          <tbody>
            {newAssets.map((asset) => (
              <ClickableTr key={asset.id} to={`/assets/${asset.id}`}>
                <Row
                  item={{
                    ...asset,
                    category: asset?.category
                      ? {
                          id: asset.category.id,
                          name: asset.category?.name || "Uncategorized",
                          color: asset.category?.color || "#575757",
                        }
                      : null,
                    mainImageExpiration: asset.mainImageExpiration
                      ? new Date(asset.mainImageExpiration)
                      : null,
                    createdAt: new Date(asset.createdAt), // Convert createdAt to Date object
                    updatedAt: new Date(asset.updatedAt), // Convert updatedAt to Date object
                  }}
                />
              </ClickableTr>
            ))}
            {newAssets.length < 5 &&
              Array(5 - newAssets.length)
                .fill(null)
                .map((_d, i) => (
                  <Tr key={i} className="h-[72px]">
                    {""}
                  </Tr>
                ))}
          </tbody>
        </Table>
      ) : (
        <div className="flex flex-1 items-center justify-center p-4">
          <DashboardEmptyState
            text="No assets yet"
            subText="Create your first asset to start building your inventory."
            ctaTo="/assets/new"
            ctaText="Create an asset"
          />
        </div>
      )}
    </div>
  );
}

const Row = ({
  item,
}: {
  item: Asset & {
    category: Pick<Category, "id" | "name" | "color"> | null;
  };
}) => {
  const { category } = item;
  return (
    <>
      {/* Item */}
      <Td className="w-full whitespace-normal p-0 md:p-0">
        <div className="flex justify-between gap-3 px-4 py-3 md:justify-normal md:px-6">
          <div className="flex items-center gap-3">
            <div className="flex size-14 shrink-0 items-center justify-center">
              <AssetImage
                asset={{
                  id: item.id,
                  mainImage: item.mainImage,
                  thumbnailImage: item.thumbnailImage,
                  mainImageExpiration: item.mainImageExpiration,
                }}
                alt={`Image of ${item.title}`}
                className="size-full rounded-[4px] border object-cover"
                withPreview
              />
            </div>
            <div className="min-w-0">
              <span className="word-break mb-1 block">
                <Button
                  to={`/assets/${item.id}`}
                  variant="link"
                  className="text-left font-medium text-color-900 hover:text-color-700"
                  target={"_blank"}
                  onlyNewTabIconOnHover={true}
                >
                  {item.title}
                </Button>
              </span>
              <div>
                <AssetStatusBadge
                  id={item.id}
                  status={item.status}
                  availableToBook={item.availableToBook}
                />
              </div>
            </div>
          </div>
        </div>
      </Td>

      {/* Category — hidden on small screens to prevent overflow */}
      <Td className="hidden md:table-cell">
        <CategoryBadge category={category} />
      </Td>
    </>
  );
};
