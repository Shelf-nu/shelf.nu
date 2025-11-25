import { useLoaderData } from "react-router";
import type { loader } from "~/routes/_layout+/dashboard";
import { EmptyState } from "./empty-state";
import { InfoTooltip } from "../shared/info-tooltip";
import { Td, Table, Tr } from "../table";

export default function MostScannedCategories() {
  const { mostScannedCategories } = useLoaderData<typeof loader>();
  return (
    <>
      <div className="rounded-t border border-b-0 border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex-1 p-4 text-left text-[14px] font-semibold  text-gray-900 md:px-6">
            Most scanned categories
          </div>
          <div className=" p-4 text-right text-[14px] font-semibold  text-gray-900 md:px-6">
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
          </div>
        </div>
      </div>
      {mostScannedCategories.length > 0 ? (
        <Table className=" border border-gray-200">
          <tbody>
            {mostScannedCategories.map((category, i) => (
              <Tr key={category.name + i} className="h-[73px]">
                <Row item={category} />
              </Tr>
            ))}
            {mostScannedCategories.length < 5 &&
              Array(5 - mostScannedCategories.length)
                .fill(null)
                .map((_d, i) => <Tr key={i} className="h-[72px]"></Tr>)}
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
  item: {
    name: string;
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
    <Td>{item.scanCount} scans</Td>
  </>
);
