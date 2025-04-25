import type { SerializeFrom } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import type { loader } from "~/routes/_layout+/dashboard";
import { getShareAgreementUrl } from "~/utils/asset";
import { EmptyState } from "./empty-state";
import { AssetImage } from "../assets/asset-image";
import { AssetStatusBadge } from "../assets/asset-status-badge";
import { InfoTooltip } from "../shared/info-tooltip";
import { Td, Table, Tr } from "../table";

export default function MostScannedAssets() {
  const { mostScannedAssets } = useLoaderData<typeof loader>();

  return (
    <>
      <div className="rounded-t border border-b-0 border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex-1 p-4 text-left text-[14px] font-semibold  text-gray-900 md:px-6">
            Most scanned assets
          </div>
          <div className=" p-4 text-right text-[14px] font-semibold  text-gray-900 md:px-6">
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
        <Table className="rounded border border-gray-200">
          <tbody>
            {mostScannedAssets.map((asset) => (
              <Tr key={asset.id}>
                <Row item={asset} />
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
        <div className="flex-1 rounded-b border border-gray-200 p-8">
          <EmptyState text="No assets scans available" />
        </div>
      )}
    </>
  );
}

const Row = ({
  item,
}: {
  item: SerializeFrom<typeof loader>["mostScannedAssets"][number];
}) => (
  <>
    {/* Item */}
    <Td className="w-full min-w-[130px] whitespace-normal p-0 md:p-0">
      <div className="flex justify-between gap-3 px-4 py-3 md:justify-normal md:px-6">
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
          <div className="min-w-[130px]">
            <span className="word-break mb-1 block font-medium">
              {item.title}
            </span>
            <div>
              <AssetStatusBadge
                kit={item?.kit}
                status={item.status}
                availableToBook={item.availableToBook}
                shareAgreementUrl={getShareAgreementUrl(item)}
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
