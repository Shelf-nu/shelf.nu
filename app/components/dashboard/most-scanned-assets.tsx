import type { Asset } from "@prisma/client";
import { useLoaderData } from "@remix-run/react";
import type { loader } from "~/routes/_layout+/dashboard";
import { EmptyState } from "./empty-state";
import { AssetImage } from "../assets/asset-image/component";
import { AssetStatusBadge } from "../assets/asset-status-badge";
import { Button } from "../shared/button";
import { InfoTooltip } from "../shared/info-tooltip";
import { Td, Table, Tr } from "../table";

export default function MostScannedAssets() {
  const { mostScannedAssets } = useLoaderData<typeof loader>();
  return (
    <>
      <div className="rounded-t border border-b-0 border-color-200">
        <div className="flex items-center justify-between">
          <div className="flex-1 p-4 text-left text-[14px] font-semibold  text-color-900 md:px-6">
            Most scanned assets
          </div>
          <div className=" p-4 text-right text-[14px] font-semibold  text-color-900 md:px-6">
            <InfoTooltip
              content={
                <>
                  <h6>Most scanned assets</h6>
                  <p>
                    Below listed assets were the most scanned among your all
                    assets
                  </p>
                </>
              }
            />
          </div>
        </div>
      </div>
      {mostScannedAssets.length > 0 ? (
        <Table className="rounded border border-color-200">
          <tbody>
            {mostScannedAssets.map((asset) => (
              <Tr key={asset.id}>
                <Row
                  item={{
                    ...asset,
                    mainImageExpiration: asset.mainImageExpiration
                      ? new Date(asset.mainImageExpiration)
                      : null,
                    createdAt: new Date(asset.createdAt), // Convert createdAt to Date object
                    updatedAt: new Date(asset.updatedAt), // Convert updatedAt to Date object
                  }}
                />
              </Tr>
            ))}
            {mostScannedAssets.length < 5 &&
              Array(5 - mostScannedAssets.length)
                .fill(null)
                .map((_d, i) => (
                  <Tr key={i} className="h-[72px]">
                    {""}
                  </Tr>
                ))}
          </tbody>
        </Table>
      ) : (
        <div className="flex-1 rounded-b border border-color-200 p-8">
          <EmptyState text="No assets scans available" />
        </div>
      )}
    </>
  );
}

const Row = ({
  item,
}: {
  item: Asset & {
    scanCount?: number;
  };
}) => (
  <>
    {/* Item */}
    <Td className="w-full min-w-[130px] whitespace-normal p-0 md:p-0">
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
            <span className="word-break mb-1 block font-medium">
              <Button
                to={`/assets/${item.id}`}
                variant="link"
                className="text-left text-color-900 hover:text-color-700"
                target={"_blank"}
                onlyNewTabIconOnHover={true}
              >
                {item.title}
              </Button>
            </span>
            <div>
              <AssetStatusBadge
                status={item.status}
                availableToBook={item.availableToBook}
              />
            </div>
          </div>
        </div>
      </div>
    </Td>

    {/* Category */}
    <Td>{item.scanCount} scans</Td>
  </>
);
