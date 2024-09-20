import { useEffect, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { useLoaderData } from "@remix-run/react";
import { FakeCheckbox } from "~/components/forms/fake-checkbox";
import { Button } from "~/components/shared/button";
import {
  parseColumnName,
  type Column,
} from "~/modules/asset-index-settings/helpers";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";
import { tw } from "~/utils/tw";

export function ConfigureColumnsDropdown() {
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
        <Button variant="secondary" icon="columns">
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
          <div className="content-inner relative mb-[60px] max-h-[412px] overflow-y-scroll">
            <div className="py-[2px]">
              <div className="px-[10px] py-2 text-gray-500">Fixed columns</div>
              <ColumnRow className="pb-2">Name</ColumnRow>
            </div>

            <div className="border-t py-[2px]">
              <div className="px-[10px] py-2 text-gray-500">Active columns</div>
              {currentColumns.map((column, index) => (
                <ColumnRow key={column.name}>
                  <div className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      id={column.name}
                      className="mr-1 hidden"
                      name={column.name}
                      checked={column.visible}
                      onChange={() => handleCheckboxChange(index)}
                    />
                    <FakeCheckbox
                      checked={column.visible}
                      className={tw(
                        "mr-1 text-white",
                        column.visible ? "text-primary" : ""
                      )}
                    />
                    <label
                      htmlFor={column.name}
                      className="flex-1 text-[14px] font-medium text-gray-700"
                      title="Custom field"
                    >
                      <span>{parseColumnName(column.name)}</span>
                      {column.name.startsWith("cf_") && (
                        <span className=" lowercase text-gray-500"> (cf)</span>
                      )}
                    </label>
                  </div>
                </ColumnRow>
              ))}
            </div>
          </div>
          <footer className="absolute bottom-0 w-full border-t bg-white p-[10px]">
            <Button
              onClick={() => {
                setIsPopoverOpen(false);
              }}
              variant="secondary"
              width="full"
              disabled={!hasChanges}
            >
              Apply
            </Button>
          </footer>
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
