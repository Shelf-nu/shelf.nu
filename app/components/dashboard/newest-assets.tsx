import type { Asset, Category } from "@prisma/client";
import { useLoaderData } from "@remix-run/react";
import type { loader } from "~/routes/_layout+/dashboard";
import { EmptyState } from "./empty-state";
import { AssetImage } from "../assets/asset-image/component";
import { AssetStatusBadge } from "../assets/asset-status-badge";
import { CategoryBadge } from "../assets/category-badge";
import { Button } from "../shared/button";
import { InfoTooltip } from "../shared/info-tooltip";
import { Td, Table, Tr } from "../table";

export default function NewestAssets() {
  const { newAssets } = useLoaderData<typeof loader>();
  return (
    <>
      <div className="border border-b-0 border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex-1 p-4 text-left text-[14px] font-semibold  text-gray-900 md:px-6">
            Newest assets
          </div>
          <div className=" p-4 text-right text-[14px] font-semibold  text-gray-900 md:px-6">
            <InfoTooltip
              content={
                <>
                  <h6>Newest assets</h6>
                  <p>Below listed assets were created recently</p>
                </>
              }
            />
          </div>
        </div>
      </div>
      {newAssets.length > 0 ? (
        <Table className="border  border-gray-200">
          <tbody>
            {newAssets.map((asset) => (
              <Tr key={asset.id}>
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
              </Tr>
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
        <div className="h-full flex-1 rounded-b border border-gray-200">
          <EmptyState text="No assets in database" />
        </div>
      )}
    </>
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
                alt={item.title}
                className="size-full rounded-[4px] border object-cover"
                withPreview
              />
            </div>
            <div className="min-w-[130px]">
              <span className="word-break mb-1 block">
                <Button
                  to={`/assets/${item.id}`}
                  variant="link"
                  className="text-left font-medium text-gray-900 hover:text-gray-700"
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

      {/* Category */}
      <Td>
        <CategoryBadge category={category} />
      </Td>
    </>
  );
};
