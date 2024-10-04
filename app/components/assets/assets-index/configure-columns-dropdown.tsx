import { useEffect, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { Reorder } from "framer-motion";
import { FakeCheckbox } from "~/components/forms/fake-checkbox";
import { HandleIcon } from "~/components/icons/library";
import { Button } from "~/components/shared/button";
import {
  parseColumnName,
  type Column,
} from "~/modules/asset-index-settings/helpers";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";
import { tw } from "~/utils/tw";

export function ConfigureColumnsDropdown() {
  const fetcher = useFetcher({
    key: "asset-index-settings-columns",
  });

  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const { settings } = useLoaderData<AssetIndexLoaderData>();
  const initialColumns = (settings?.columns as Column[])?.sort(
    (a, b) => a.position - b.position
  );

  const [currentColumns, setCurrentColumns] = useState(initialColumns);

  useEffect(() => {
    setCurrentColumns(initialColumns);
  }, [initialColumns]);

  const handleCheckboxChange = (index: number) => {
    setCurrentColumns((prevColumns) => {
      const newColumns = prevColumns.map((column, i) =>
        i === index ? { ...column, visible: !column.visible } : column
      );
      return newColumns;
    });
  };

  const hasChanges =
    JSON.stringify(initialColumns) !== JSON.stringify(currentColumns);

  return (
    <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
      <PopoverTrigger asChild>
        <Button variant="secondary" icon="columns" className="text-gray-500">
          Columns
        </Button>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          align="end"
          className={tw(
            "mt-1  w-[240px] rounded-md border border-gray-300 bg-white p-0"
          )}
        >
          <fetcher.Form action="/api/asset-index-settings" method="post">
            <input type="hidden" name="intent" value="changeColumns" />
            <div className="content-inner relative mb-[60px] max-h-[412px] overflow-y-scroll">
              <div className="py-[2px]">
                <div className="px-[10px] py-2 text-gray-500">
                  Fixed columns
                </div>
                <ColumnRow className="flex items-center gap-1 pb-2">
                  <FakeCheckbox
                    checked={true}
                    className={tw("mr-1 text-gray-400")}
                  />
                  Name
                </ColumnRow>
              </div>

              <div className="border-t py-[2px]">
                <div className="px-[10px] py-2 text-gray-500">
                  Columns ({currentColumns.length})
                </div>
                <Reorder.Group
                  values={currentColumns}
                  onReorder={setCurrentColumns}
                >
                  {currentColumns.map((column, index) => (
                    <Reorder.Item key={column.name} value={column}>
                      <ColumnRow key={column.name}>
                        <div className="flex items-center gap-1">
                          {/* We only add this data for custom fields, because cfType has to be  of type CustomFieldType. It cant be an empty string  */}
                          {column.name.startsWith("cf_") && (
                            <input
                              type="hidden"
                              name={`columns[${index}][cfType]`}
                              value={column.cfType}
                            />
                          )}

                          <input
                            type="hidden"
                            name={`columns[${index}][name]`}
                            value={column.name}
                          />
                          <input
                            type="hidden"
                            name={`columns[${index}][position]`}
                            value={index}
                          />
                          <input
                            type="checkbox"
                            id={column.name}
                            className="mr-1 hidden"
                            name={`columns[${index}][visible]`}
                            checked={column.visible}
                            onChange={() => handleCheckboxChange(index)}
                          />

                          <label
                            htmlFor={column.name}
                            className="flex flex-1 items-center text-[14px] font-medium text-gray-700 hover:cursor-pointer"
                            title="Custom field"
                          >
                            {" "}
                            <FakeCheckbox
                              checked={column.visible}
                              className={tw(
                                "mr-1 text-white",
                                column.visible ? "text-primary" : ""
                              )}
                            />
                            <span>{parseColumnName(column.name)}</span>
                            {column.name.startsWith("cf_") && (
                              <span className=" lowercase text-gray-500">
                                {" "}
                                (cf)
                              </span>
                            )}
                          </label>
                          <div className="h-auto w-2 cursor-move text-gray-500">
                            <HandleIcon />
                          </div>
                        </div>
                      </ColumnRow>
                    </Reorder.Item>
                  ))}
                </Reorder.Group>
              </div>
            </div>
            <footer className="absolute bottom-0 w-full border-t bg-white p-[10px]">
              <Button disabled={!hasChanges} variant="secondary" width="full">
                Apply
              </Button>
            </footer>
          </fetcher.Form>
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}

function ColumnRow({
  children,
  className,
}: {
  children: React.ReactNode | string;
  className?: string;
}) {
  return <div className={tw("px-[10px] py-[6px]", className)}>{children}</div>;
}
