import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { ChevronDownIcon } from "@radix-ui/react-icons";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { useNavigation } from "react-router";
import { useModelFilters } from "~/hooks/use-model-filters";
import type {
  ModelFilterItem,
  ModelFilterProps,
} from "~/hooks/use-model-filters";
import { isFormProcessing } from "~/utils/form";
import { handleActivationKeyPress } from "~/utils/keyboard";
import { tw } from "~/utils/tw";
import { EmptyState } from "../dynamic-dropdown/empty-state";
import { InnerLabel } from "../forms/inner-label";
import Input from "../forms/input";
import { CheckIcon } from "../icons/library";
import { Button } from "../shared/button";
import type { IconType } from "../shared/icons-map";
import { Spinner } from "../shared/spinner";
import When from "../when/when";

const dedupeItems = (list: ModelFilterItem[]) => {
  const map = new Map<string, ModelFilterItem>();
  list.forEach((item) => {
    if (!map.has(item.id)) {
      map.set(item.id, item);
    }
  });
  return Array.from(map.values());
};

type Props = ModelFilterProps & {
  className?: string;
  triggerWrapperClassName?: string;
  style?: CSSProperties;
  fieldName?: string;
  /** Optional custom z-index class for the popover content. */
  popoverZIndexClassName?: string;

  /** This is the html label */
  label?: ReactNode;

  /** This is to be shown inside the popover */
  contentLabel?: ReactNode;

  /** Hide the label */
  hideLabel?: boolean;

  /** Is this input required. Used to show a required star */
  required?: boolean;
  searchIcon?: IconType;
  showSearch?: boolean;
  defaultValue?: string;
  renderItem?: (item: ModelFilterItem) => ReactNode;
  extraContent?:
    | ReactNode
    | ((helpers: {
        onItemCreated: (item: ModelFilterItem) => void;
        closePopover: () => void;
      }) => ReactNode);
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

  /**
   * A special item that will be added to the list in dropdown, this item can be used to filter items
   * like "uncategorized" or "untagged" etc.
   */
  withoutValueItem?: {
    id: string;
    name: string;
  };

  /**
   * A special item that will be added to the list in dropdown, this item can be used to filter items
   * that have a value, like "In custody" or "Has location" etc.
   */
  withValueItem?: {
    id: string;
    name: string;
  };
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
  withoutValueItem,
  withValueItem,
  popoverZIndexClassName,
  ...hookProps
}: Props) {
  const [createdItems, setCreatedItems] = useState<ModelFilterItem[]>([]);
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const navigation = useNavigation();
  const isSearching = isFormProcessing(navigation.state);

  const [selectedValue, setSelectedValue] = useState<string | undefined>(
    defaultValue
  );

  const {
    searchQuery,
    setSearchQuery,
    handleSearchQueryChange,
    items,
    totalItems,
    clearFilters,
    selectedItems,
    resetModelFiltersFetcher,
    handleSelectItemChange,
    getAllEntries,
  } = useModelFilters({ model, selectionMode, ...hookProps });

  const itemsWithCreated = useMemo(
    () => dedupeItems([...createdItems, ...items]),
    [createdItems, items]
  );

  const itemsToRender = useMemo(
    () =>
      excludeItems
        ? itemsWithCreated.filter((i) => !excludeItems.includes(i.id))
        : itemsWithCreated,
    [excludeItems, itemsWithCreated]
  );

  // Create array that includes special items if provided
  const allItemsToRender = useMemo(() => {
    const specialItems: ModelFilterItem[] = [];

    if (withValueItem) {
      specialItems.push({
        id: withValueItem.id,
        name: withValueItem.name,
        metadata: {},
      });
    }

    if (withoutValueItem) {
      specialItems.push({
        id: withoutValueItem.id,
        name: withoutValueItem.name,
        metadata: {},
      });
    }

    if (specialItems.length === 0) return itemsToRender;

    return [...specialItems, ...itemsToRender];
  }, [withValueItem, withoutValueItem, itemsToRender]);

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
  const selectedItem = allItemsToRender.find((i) => i.id === selectedValue);
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

  const handleItemCreated = (item: ModelFilterItem) => {
    setCreatedItems((prev) => dedupeItems([item, ...prev]));
    handleItemChange(item.id);
    setSearchQuery("");
    resetModelFiltersFetcher();
    setIsPopoverOpen(false);
  };

  const extraContentNode =
    typeof extraContent === "function"
      ? extraContent({
          onItemCreated: handleItemCreated,
          closePopover: () => setIsPopoverOpen(false),
        })
      : extraContent;

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
                className="flex w-full items-center justify-between whitespace-nowrap rounded border border-color-300 px-[14px] py-2 text-sm hover:cursor-pointer disabled:opacity-50"
              >
                <span
                  className={tw(
                    "truncate whitespace-nowrap pr-2",
                    selectedValue === undefined && "text-color-500"
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
                popoverZIndexClassName ?? "z-[100]",
                "overflow-y-auto rounded-md border border-color-300 bg-surface",
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
                <div className="text-xs font-semibold text-color-700">
                  {contentLabel}
                </div>
                <When truthy={selectedItems?.length > 0 && showSearch}>
                  <Button
                    as="button"
                    variant="link"
                    className="whitespace-nowrap text-xs font-normal text-color-500 hover:text-color-600"
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
                    className="text-color-500"
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
                      className="z-100 pointer-events-auto absolute right-6 top-0 h-full border-0 p-0 text-center text-color-400 hover:text-color-900"
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
                {/* Show special items only when there's no search query */}
                {(withValueItem || withoutValueItem) && searchQuery === "" && (
                  <>
                    <div className="h-2 w-full bg-color-50" />
                    {withValueItem && (
                      <div
                        key={withValueItem.id}
                        className={tw(
                          "flex cursor-pointer select-none items-center justify-between gap-4 px-6 py-4 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-color-100 focus:bg-color-100",
                          withValueItem.id === selectedValue && "bg-color-100"
                        )}
                        role="option"
                        aria-selected={withValueItem.id === selectedValue}
                        tabIndex={0}
                        onClick={() => {
                          handleItemChange(withValueItem.id);
                        }}
                        onKeyDown={handleActivationKeyPress(() =>
                          handleItemChange(withValueItem.id)
                        )}
                      >
                        <span className="max-w-[350px] truncate whitespace-nowrap pr-2">
                          {withValueItem.name}
                        </span>
                        <When truthy={withValueItem.id === selectedValue}>
                          <span className="h-auto w-[18px] text-primary">
                            <CheckIcon />
                          </span>
                        </When>
                      </div>
                    )}
                    {withoutValueItem && (
                      <div
                        key={withoutValueItem.id}
                        className={tw(
                          "flex cursor-pointer select-none items-center justify-between gap-4 px-6 py-4 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-color-100 focus:bg-color-100",
                          withoutValueItem.id === selectedValue &&
                            "bg-color-100"
                        )}
                        role="option"
                        aria-selected={withoutValueItem.id === selectedValue}
                        tabIndex={0}
                        onClick={() => {
                          handleItemChange(withoutValueItem.id);
                        }}
                        onKeyDown={handleActivationKeyPress(() =>
                          handleItemChange(withoutValueItem.id)
                        )}
                      >
                        <span className="max-w-[350px] truncate whitespace-nowrap pr-2">
                          {withoutValueItem.name}
                        </span>
                        <When truthy={withoutValueItem.id === selectedValue}>
                          <span className="h-auto w-[18px] text-primary">
                            <CheckIcon />
                          </span>
                        </When>
                      </div>
                    )}
                    <div className="h-2 w-full bg-color-50" />
                  </>
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
                        "flex cursor-pointer select-none items-center justify-between gap-4 px-6 py-4 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-color-100 focus:bg-color-100",
                        item.id === selectedValue && "bg-color-100"
                      )}
                      role="option"
                      aria-selected={item.id === selectedValue}
                      tabIndex={0}
                      onClick={() => {
                        handleItemChange(item.id);
                      }}
                      onKeyDown={handleActivationKeyPress(() =>
                        handleItemChange(item.id)
                      )}
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
                      className=" flex w-full cursor-pointer select-none items-center justify-between px-6 py-3 text-sm font-medium text-color-600 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-color-100 focus:bg-color-100"
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
                <div className="border-t p-3 text-color-500">
                  Showing {items.length} out of {totalItems}, type to search for
                  more
                </div>
              </When>

              <When truthy={typeof extraContentNode !== "undefined"}>
                <div className="border-t px-3 pb-3">{extraContentNode}</div>
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
