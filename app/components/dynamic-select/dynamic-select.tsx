import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDownIcon } from "@radix-ui/react-icons";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { useNavigation } from "@remix-run/react";
import { useModelFilters } from "~/hooks/use-model-filters";
import type {
  ModelFilterItem,
  ModelFilterProps,
} from "~/hooks/use-model-filters";
import { isFormProcessing } from "~/utils/form";
import { tw } from "~/utils/tw";
import { EmptyState } from "../dynamic-dropdown/empty-state";
import { InnerLabel } from "../forms/inner-label";
import Input from "../forms/input";
import { CheckIcon } from "../icons/library";
import { Button } from "../shared/button";
import type { IconType } from "../shared/icons-map";
import { Spinner } from "../shared/spinner";
import When from "../when/when";

type Props = ModelFilterProps & {
  className?: string;
  triggerWrapperClassName?: string;
  style?: React.CSSProperties;
  fieldName?: string;

  /** This is the html label */
  label?: React.ReactNode;

  /** This is to be shown inside the popover */
  contentLabel?: React.ReactNode;

  /** Hide the label */
  hideLabel?: boolean;

  /** Is this input required. Used to show a required star */
  required?: boolean;
  searchIcon?: IconType;
  showSearch?: boolean;
  defaultValue?: string;
  renderItem?: (item: ModelFilterItem) => React.ReactNode;
  extraContent?: React.ReactNode;
  disabled?: boolean;
  placeholder?: string;
  closeOnSelect?: boolean;
  excludeItems?: string[];
  /** Allow undefined for deselection cases */
  onChange?: ((value: string | undefined) => void) | null /**
   * Allow item to unselect on clicking again
   */;
  allowClear?: boolean;
  hidden?: boolean;

  /** Allows you to hide the show all button */
  hideShowAll?: boolean;
};

export default function DynamicSelect({
  className,
  triggerWrapperClassName,
  style,
  fieldName,
  contentLabel,
  label,
  hideLabel,
  required,
  searchIcon = "search",
  showSearch = true,
  defaultValue,
  model,
  renderItem,
  extraContent,
  disabled,
  placeholder = `Select ${model.name}`,
  closeOnSelect = false,
  excludeItems,
  onChange = null,
  allowClear,
  selectionMode = "none",
  hidden = false,
  hideShowAll = false,
  ...hookProps
}: Props) {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const navigation = useNavigation();
  const isSearching = isFormProcessing(navigation.state);

  const [selectedValue, setSelectedValue] = useState<string | undefined>(
    defaultValue
  );

  const {
    searchQuery,
    handleSearchQueryChange,
    items,
    totalItems,
    clearFilters,
    selectedItems,
    resetModelFiltersFetcher,
    handleSelectItemChange,
    getAllEntries,
  } = useModelFilters({ model, selectionMode, ...hookProps });

  const itemsToRender = useMemo(
    () =>
      excludeItems ? items.filter((i) => !excludeItems.includes(i.id)) : items,
    [excludeItems, items]
  );

  function handleItemChange(id: string) {
    const isDeselecting = allowClear && selectedValue === id;

    // Update local state
    setSelectedValue(isDeselecting ? undefined : id);

    // Always update URL params and parent state
    handleSelectItemChange(id);

    // Notify parent with the new value
    onChange?.(isDeselecting ? undefined : id);

    if (closeOnSelect) {
      setIsPopoverOpen(false);
    }
  }

  useEffect(
    function updateSelectedIfDefaultValueChange() {
      setSelectedValue(defaultValue);
    },
    [defaultValue]
  );

  /** This is needed so we know what to show on the trigger */
  const selectedItem = items.find((i) => i.id === selectedValue);
  const triggerValue = selectedItem
    ? typeof renderItem === "function"
      ? renderItem({ ...selectedItem, metadata: selectedItem })
      : selectedItem.name
    : placeholder;

  if (hidden) {
    return (
      <input
        key={`${selectedValue}-${defaultValue}`}
        type="hidden"
        value={selectedValue}
        name={fieldName ?? model.name}
      />
    );
  }

  return (
    <>
      <div className="relative w-full">
        <input
          key={`${selectedValue}-${defaultValue}`}
          type="hidden"
          value={selectedValue}
          name={fieldName ?? model.name}
        />
        <MobileStyles open={isPopoverOpen} />

        <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
          <PopoverTrigger
            disabled={disabled}
            asChild
            className={tw(
              triggerWrapperClassName,
              "inline-flex w-full items-center gap-2 "
            )}
          >
            <button
              className={tw(
                "w-full",
                disabled && "cursor-not-allowed opacity-60"
              )}
            >
              {label && (
                <InnerLabel hideLg={hideLabel} required={required}>
                  {label}
                </InnerLabel>
              )}

              <div
                ref={triggerRef}
                className="flex w-full items-center justify-between whitespace-nowrap rounded border border-gray-300 px-[14px] py-2 text-base  hover:cursor-pointer disabled:opacity-50"
              >
                <span
                  className={tw(
                    "truncate whitespace-nowrap pr-2",
                    selectedValue === undefined && "text-gray-500"
                  )}
                >
                  {triggerValue}
                </span>
                <ChevronDownIcon />
              </div>
            </button>
          </PopoverTrigger>
          <PopoverPortal>
            <PopoverContent
              className={tw(
                "z-[100] overflow-y-auto rounded-md border border-gray-300 bg-white",
                className
              )}
              style={{
                ...style,
                width: triggerRef?.current?.clientWidth,
              }}
              align="center"
              sideOffset={5}
            >
              <div className="flex items-center justify-between p-3">
                <div className="text-xs font-semibold text-gray-700">
                  {contentLabel}
                </div>
                <When truthy={selectedItems?.length > 0 && showSearch}>
                  <Button
                    as="button"
                    variant="link"
                    className="whitespace-nowrap text-xs font-normal text-gray-500 hover:text-gray-600"
                    onClick={() => {
                      setSelectedValue(undefined);
                      clearFilters();
                    }}
                  >
                    Clear selection
                  </Button>
                </When>
              </div>

              <When truthy={showSearch}>
                <div className="filters-form relative border-y border-y-gray-200 p-3">
                  <Input
                    type="text"
                    label={`Search ${contentLabel}`}
                    placeholder={`Search ${contentLabel}`}
                    hideLabel
                    className="text-gray-500"
                    icon={searchIcon}
                    value={searchQuery}
                    onChange={handleSearchQueryChange}
                    autoFocus
                  />
                  <When truthy={Boolean(searchQuery)}>
                    <Button
                      icon="x"
                      variant="tertiary"
                      disabled={Boolean(searchQuery)}
                      onClick={() => {
                        setSelectedValue(undefined);
                        resetModelFiltersFetcher();
                      }}
                      className="z-100 pointer-events-auto absolute right-6 top-0 h-full border-0 p-0 text-center text-gray-400 hover:text-gray-900"
                    />
                  </When>
                </div>
              </When>

              <div className="max-h-[320px] divide-y overflow-y-auto">
                {searchQuery !== "" && items.length === 0 && (
                  <EmptyState
                    searchQuery={searchQuery}
                    modelName={model.name}
                  />
                )}
                {itemsToRender.map((item) => {
                  //making sure only showinng the option if it as some value.
                  const value =
                    typeof renderItem === "function" ? (
                      renderItem({ ...item, metadata: item })
                    ) : (
                      <div className="flex items-center truncate text-sm font-medium">
                        {item.name}
                      </div>
                    );
                  if (!value) {
                    return null;
                  }
                  return (
                    <div
                      key={item.id}
                      className={tw(
                        "flex cursor-pointer select-none items-center justify-between gap-4 px-6 py-4 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-gray-100 focus:bg-gray-100",
                        item.id === selectedValue && "bg-gray-100"
                      )}
                      onClick={() => {
                        handleItemChange(item.id);
                      }}
                    >
                      <span className="max-w-[350px] truncate whitespace-nowrap pr-2">
                        {value}
                      </span>
                      <When truthy={item.id === selectedValue}>
                        <span className="h-auto w-[18px] text-primary">
                          <CheckIcon />
                        </span>
                      </When>
                    </div>
                  );
                })}
                {items.length < totalItems &&
                  searchQuery === "" &&
                  !hideShowAll && (
                    <button
                      type="button"
                      disabled={isSearching}
                      onClick={getAllEntries}
                      className=" flex w-full cursor-pointer select-none items-center justify-between px-6 py-3 text-sm font-medium text-gray-600 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-gray-100 focus:bg-gray-100"
                    >
                      Show all
                      <span>
                        {isSearching ? (
                          <Spinner className="size-4" />
                        ) : (
                          <ChevronDownIcon className="size-4" />
                        )}
                      </span>
                    </button>
                  )}
              </div>

              <When truthy={totalItems > 6}>
                <div className="border-t p-3 text-gray-500">
                  Showing {items.length} out of {totalItems}, type to search for
                  more
                </div>
              </When>

              <When truthy={typeof extraContent !== "undefined"}>
                <div className="border-t px-3 pb-3">{extraContent}</div>
              </When>
            </PopoverContent>
          </PopoverPortal>
        </Popover>
      </div>
    </>
  );
}

export const MobileStyles = ({ open }: { open: boolean }) =>
  open && (
    <>
      <div
        // eslint-disable-next-line tailwindcss/migration-from-tailwind-2
        className={tw(
          "extra-overlay fixed right-0 top-0 z-[999] h-screen w-screen cursor-pointer bg-black bg-opacity-50 backdrop-blur transition duration-300 ease-in-out md:hidden",
          open ? "visible" : "invisible opacity-0"
        )}
      ></div>
      <style
        dangerouslySetInnerHTML={{
          __html: `@media (max-width: 640px) {
                body {
                  overflow: hidden;
                }

                [data-radix-popper-content-wrapper] {
                  z-index: 9999 !important;
                  top: 20px !important;
                  left: 50% !important;
                  transform: translate(-50%, 0) !important;
                  width: calc(100% - 40px) !important;
              }
              [data-radix-popper-content-wrapper] > div {
                width: 100% !important;
              }

          }`,
        }} // is a hack to fix the dropdown menu not being in the right place on mobile
        // can not target [data-radix-popper-content-wrapper] for this file only with css
        // so we have to use dangerouslySetInnerHTML
        // PR : https://github.com/Shelf-nu/shelf.nu/pull/304
      ></style>
    </>
  );
