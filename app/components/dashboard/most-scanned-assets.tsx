import type { Asset } from "@prisma/client";
import { useLoaderData } from "@remix-run/react";
import type { loader } from "~/routes/_layout+/dashboard";
import { userFriendlyAssetStatus } from "~/utils";
import { AssetImage } from "../assets/asset-image";
import { Badge } from "../shared";
import { InfoTooltip } from "../shared/info-tooltip";
import { Th, Td, Table, Tr } from "../table";

export default function MostScannedAssets() {
  const { mostScannedAssets } = useLoaderData<typeof loader>();
  return (
    <Table className="h-[420px] rounded border border-gray-200">
      <thead>
        <tr>
          <Th className="text-[14px] font-semibold text-gray-900">
            Most scanned assets
          </Th>
          <Th className="text-right">
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
          </Th>
        </tr>
      </thead>
      <tbody>
        {mostScannedAssets.map((asset) => (
          <Tr key={asset.id}>
            {/* @TODO resolve this issue
            @ts-ignore */}
            <Row item={asset} />
          </Tr>
        ))}
        {mostScannedAssets.length < 5 &&
          Array(5 - mostScannedAssets.length)
            .fill(null)
            .map((i) => (
              <Tr key={i} className="h-[72px]">
                {""}
              </Tr>
            ))}
      </tbody>
    </Table>
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
    <Td className="w-full whitespace-normal p-0 md:p-0">
      <div className="flex justify-between gap-3 px-4 py-3 md:justify-normal md:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center">
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
          <div className="min-w-[130px]">
            <span className="word-break mb-1 block font-medium">
              {item.title}
            </span>
            <div>
              <Badge
                color={item.status === "AVAILABLE" ? "#12B76A" : "#2E90FA"}
              >
                {userFriendlyAssetStatus(item.status)}
              </Badge>
            </div>
          </div>
        </div>
      </div>
    </Td>

    {/* Category */}
    <Td className="hidden md:table-cell">{item.scanCount} scans</Td>
  </>
);
