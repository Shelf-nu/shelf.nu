import type { Category } from "@prisma/client";
import { useLoaderData } from "@remix-run/react";
import type { loader } from "~/routes/_layout+/dashboard";
import { InfoTooltip } from "../shared/info-tooltip";
import { Th, Td, Table, Tr } from "../table";

export default function MostScannedCategories() {
  const { mostScannedCategories } = useLoaderData<typeof loader>();
  return (
    <Table className="h-[420px] rounded border border-gray-200">
      <thead>
        <tr>
          <Th className="text-[14px] font-semibold text-gray-900">
            Most scanned categories
          </Th>
          <Th className="text-right">
            <InfoTooltip
              content={
                <>
                  <h6>Most scanned categories</h6>
                  <p>
                    Below listed categories were the most scanned among your all
                    categories
                  </p>
                </>
              }
            />
          </Th>
        </tr>
      </thead>
      <tbody>
        {mostScannedCategories.map((category) => (
          <Tr key={category.name}>
            {/* @TODO resolve this issue
            @ts-ignore */}
            <Row item={category} />
          </Tr>
        ))}
        {mostScannedCategories.length < 5 &&
          Array(5 - mostScannedCategories.length)
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
  item: Category & {
    scanCount?: number;
    assetCount?: number;
  };
}) => (
  <>
    {/* Item */}
    <Td className="w-full whitespace-normal p-0 md:p-0">
      <div className="flex justify-between gap-3 px-4 py-3 md:justify-normal md:px-6">
        <div className="flex items-center gap-3">
          <div className="min-w-[130px]">
            <span className="word-break mb-1 block font-medium">
              {item.name}
            </span>
            <span className="block text-gray-600">
              {item.assetCount} Assets
            </span>
          </div>
        </div>
      </div>
    </Td>

    {/* Category */}
    <Td className="hidden md:table-cell">{item.scanCount} scans</Td>
  </>
);
