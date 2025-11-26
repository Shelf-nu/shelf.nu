import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { Reorder } from "framer-motion";
import { useFetcher, useLoaderData } from "react-router";
import { FakeCheckbox } from "~/components/forms/fake-checkbox";
import { ChevronRight, HandleIcon } from "~/components/icons/library";
import { Button } from "~/components/shared/button";
import { useDisabled } from "~/hooks/use-disabled";
import { useKeyboardReorder } from "~/hooks/use-keyboard-reorder";
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

  // Initialize keyboard reordering hook
  const { handleKeyDown, announcement, itemRefs } = useKeyboardReorder({
    items: currentColumns,
    onReorder: setCurrentColumns,
    getItemName: (column) => parseColumnName(column.name),
  });

  const handleCheckboxChange = (index: number) => {
    setCurrentColumns((prevColumns) => {
      const newColumns = prevColumns.map((column, i) =>
        i === index ? { ...column, visible: !column.visible } : column
      );
      return newColumns;
    });
  };

  /** Handle selecting all columns */
  const handleSelectAll = () => {
    setCurrentColumns((prevColumns) =>
      prevColumns.map((column) => ({ ...column, visible: true }))
    );
  };

  /** Handle deselecting all columns */
  const handleDeselectAll = () => {
    setCurrentColumns((prevColumns) =>
      prevColumns.map((column) => ({ ...column, visible: false }))
    );
  };

  const hasChanges =
    JSON.stringify(initialColumns) !== JSON.stringify(currentColumns);

  const disabled = useDisabled(fetcher);

  return (
    <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          icon="columns"
          className="mt-2 font-normal text-gray-500 md:mt-0"
          width="full"
        >
          Columns
        </Button>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          align="end"
          className={tw(
            "z-20 mt-1  w-[240px] rounded-md border border-gray-300 bg-white p-0"
          )}
        >
          <fetcher.Form action="/api/asset-index-settings" method="post">
            <input type="hidden" name="intent" value="changeColumns" />
            {/* ARIA live region for screen reader announcements */}
            <div
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className="sr-only"
            >
              {announcement}
            </div>
            <div className="content-inner relative mb-[60px] max-h-[412px] overflow-y-scroll">
              <div className="py-[2px]">
                <div className="px-[10px] py-2 text-gray-500">
                  Fixed columns
                </div>
                <ColumnRow className="flex items-center gap-1 pb-2">
                  <FakeCheckbox
                    checked={true}
                    className={tw("mr-1 text-gray-600")}
                  />
                  Name
                </ColumnRow>
              </div>

              <div className="border-t py-[2px]">
                <div className="flex items-center justify-between px-[10px] py-2 text-gray-500">
                  <div>
                    <div>Columns ({currentColumns.length})</div>
                    <div className="text-xs text-gray-400">
                      Alt+↑↓ to reorder
                    </div>
                  </div>
                  <ColumnsBulkActions
                    onSelectAll={handleSelectAll}
                    onDeselectAll={handleDeselectAll}
                  />
                </div>
                {/* Screen reader instructions */}
                <div className="sr-only" id="reorder-instructions">
                  Use Tab to navigate between column labels and drag handles.
                  Press Space or Enter on a column label to toggle its
                  visibility. Focus the drag handle and press Alt plus arrow up
                  or arrow down to reorder columns.
                </div>
                <Reorder.Group
                  values={currentColumns}
                  onReorder={setCurrentColumns}
                  as="ul"
                  role="list"
                  aria-label="Reorderable columns list"
                  aria-describedby="reorder-instructions"
                >
                  {currentColumns.map((column, index) => (
                    <Reorder.Item
                      key={column.name}
                      value={column}
                      as="li"
                      role="listitem"
                      aria-label={`${parseColumnName(column.name)}, position ${
                        index + 1
                      } of ${currentColumns.length}`}
                    >
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
                            role="checkbox"
                            aria-checked={column.visible}
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === " " || e.key === "Enter") {
                                e.preventDefault();
                                handleCheckboxChange(index);
                              }
                            }}
                            className="flex flex-1 items-center text-[14px] font-medium text-gray-700 hover:cursor-pointer focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary"
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
                          <button
                            type="button"
                            ref={(el) => {
                              itemRefs.current[index] = el;
                            }}
                            onKeyDown={(e) => handleKeyDown(e, index)}
                            className="flex h-auto cursor-move items-center p-1 text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary"
                            aria-label={`Reorder ${parseColumnName(
                              column.name
                            )}`}
                            aria-describedby="reorder-instructions"
                            aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                            title="Drag to reorder or use Alt+Arrow keys"
                            tabIndex={0}
                          >
                            <div className="h-auto w-2">
                              <HandleIcon />
                            </div>
                          </button>
                        </div>
                      </ColumnRow>
                    </Reorder.Item>
                  ))}
                </Reorder.Group>
              </div>
            </div>
            <footer className="absolute bottom-0 w-full border-t bg-white p-[10px]">
              <Button
                disabled={!hasChanges || disabled}
                variant="secondary"
                width="full"
              >
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
  children: ReactNode | string;
  className?: string;
}) {
  return <div className={tw("px-[10px] py-[6px]", className)}>{children}</div>;
}

function ColumnsBulkActions({
  onSelectAll,
  onDeselectAll,
}: {
  onSelectAll: () => void;
  onDeselectAll: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger>
        <ChevronRight className="mr-2 rotate-90" />
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          align="end"
          className={tw(
            "z-20 mt-2 w-[200px] rounded-md border border-gray-300 bg-white p-0"
          )}
        >
          <Button
            className=" justify-start whitespace-nowrap p-2 text-gray-700 hover:bg-gray-50 hover:text-gray-700 "
            variant="link"
            width="full"
            onClick={() => {
              onSelectAll();
              setIsOpen(false);
            }}
          >
            Select all
          </Button>

          <Button
            className=" justify-start whitespace-nowrap p-2 text-gray-700 hover:bg-gray-50 hover:text-gray-700  "
            variant="link"
            width="full"
            onClick={() => {
              onDeselectAll();
              setIsOpen(false);
            }}
          >
            Disselect all
          </Button>
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}
