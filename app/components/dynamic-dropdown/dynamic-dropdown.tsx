import { cloneElement, useEffect, useMemo, useState } from "react";
import { useFetcher, useLoaderData, useSearchParams } from "@remix-run/react";
import type { AllowedModelNames } from "~/routes/api+/model-filters";
import { tw } from "~/utils";
import Input from "../forms/input";
import { CheckIcon } from "../icons";
import { Badge, Button } from "../shared";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../shared/dropdown";
import type { Icon } from "../shared/icons-map";
import When from "../when/when";

type DropdownItem = { id: string; name: string; color?: string };

type Props<T> = {
  className?: string;
  style?: React.CSSProperties;
  trigger: React.ReactElement;
  label?: React.ReactNode;
  searchIcon?: Icon;
  /** name of key in loader which is used to pass initial data */
  loaderKey: string;
  model: {
    /** name of the model for which the query has to run */
    name: AllowedModelNames;
    /** name of key for which we have to search the value */
    key: keyof T;
  };
};

export default function DynamicDropdown<T>({
  className,
  style,
  label = "Filter",
  trigger,
  searchIcon = "search",
  model,
  loaderKey,
}: Props<T>) {
  /** @TODO Find a better way */
  const [initialItems, setInitialItems] = useState<Array<DropdownItem>>([]);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [, setSearchParams] = useSearchParams();
  const loaderData = useLoaderData();

  const fetcher = useFetcher<Array<DropdownItem>>();

  useEffect(() => {
    setSearchParams({ [model.name]: selectedItems });
  }, [model.name, selectedItems, setSearchParams]);

  useEffect(
    function loadInitialItems() {
      const items = (loaderData[loaderKey] ?? []) as Array<DropdownItem>;
      setInitialItems(items);
    },
    [loaderData, loaderKey]
  );

  const items = useMemo(() => {
    if (fetcher.data) {
      return fetcher.data;
    }

    return initialItems;
  }, [fetcher.data, initialItems]);

  return (
    <div className="relative w-full">
      <div className="hidden">
        {items.map((item) => (
          <input
            type="checkbox"
            checked
            value={item.id}
            key={item.id}
            name={model.name}
            readOnly
          />
        ))}
      </div>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger className="inline-flex items-center gap-2 text-gray-500">
          {cloneElement(trigger)}
          <When truthy={selectedItems.length > 0}>
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 px-2 py-[2px] text-xs font-medium text-gray-700">
              {selectedItems.length}
            </div>
          </When>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className={tw(
            "max-h-[300px] w-[290px] overflow-y-auto md:w-[350px]",
            className
          )}
          style={style}
        >
          <div>
            <div className="mb-[6px] flex items-center justify-between">
              <div className="text-xs text-gray-500">{label}</div>
              <When truthy={selectedItems.length > 0}>
                <Button
                  as="button"
                  variant="link"
                  className="whitespace-nowrap text-xs font-normal text-gray-500 hover:text-gray-600"
                  onClick={() => {
                    setSelectedItems([]);
                  }}
                >
                  Clear filter
                </Button>
              </When>
            </div>
            <div className="filters-form relative">
              <Input
                type="text"
                label={`Search ${label?.toLocaleString()}`}
                placeholder={`Search ${label?.toLocaleString()}`}
                hideLabel
                className="mb-2 text-gray-500"
                icon={searchIcon}
                autoFocus
                value={searchQuery}
                onChange={(e) => {
                  if (e.target.value) {
                    fetcher.submit(
                      {
                        model: model.name,
                        queryKey: model.key as string,
                        queryValue: e.target.value,
                      },
                      { method: "GET", action: "/api/model-filters" }
                    );
                  }

                  setSearchQuery(e.target.value);
                }}
              />
              <When truthy={true}>
                <Button
                  icon="x"
                  variant="tertiary"
                  disabled={Boolean(searchQuery)}
                  onClick={() => {
                    setSearchQuery("");
                  }}
                  className="z-100 pointer-events-auto absolute right-[14px] top-0 h-full border-0 p-0 text-center text-gray-400 hover:text-gray-900"
                />
              </When>
            </div>
            <div>
              {items.map((item) => (
                <label
                  key={item.id}
                  htmlFor={item.id}
                  className="relative flex cursor-default select-none items-center rounded-lg px-2 py-1.5 text-sm font-medium outline-none focus:bg-gray-100 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-gray-100 "
                >
                  <Badge color={item.color ?? "red"} noBg>
                    {item.name}
                  </Badge>
                  <input
                    id={item.id}
                    type="checkbox"
                    value={item.id}
                    className="hidden"
                    checked={selectedItems.includes(item.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedItems((prev) => [...prev, item.id]);
                      } else {
                        setSelectedItems((prev) =>
                          prev.filter((p) => p !== item.id)
                        );
                      }
                    }}
                  />
                  {selectedItems.includes(item.id) ? (
                    <span className="absolute right-2 flex  items-center justify-center text-primary">
                      <CheckIcon />
                    </span>
                  ) : null}
                </label>
              ))}
            </div>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
