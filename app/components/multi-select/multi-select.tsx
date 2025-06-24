import React, { useCallback, useMemo, useState } from "react";
import _ from "lodash";
import { InfoIcon } from "lucide-react";
import { ReactTags } from "react-tag-autocomplete";
import type { Tag } from "react-tag-autocomplete";
import { tw } from "~/utils/tw";
import { InnerLabel } from "../forms/inner-label";
import { Tooltip, TooltipContent, TooltipTrigger } from "../shared/tooltip";
import When from "../when/when";

type MultiSelectProps<T> = {
  className?: string;
  items: T[];
  labelKey: keyof T;
  valueKey: keyof T;
  name: string;
  label?: string;
  defaultSelected?: T[];
  disabled?: boolean;
  error?: string;
  tooltip?: { title: string; content: string };
  placeholder?: string;
};

export default function MultiSelect<T>({
  className,
  items,
  labelKey,
  valueKey,
  label = "items",
  name,
  defaultSelected,
  disabled,
  error,
  tooltip,
  placeholder,
}: MultiSelectProps<T>) {
  /* This is a workaround for the SSR issue with react-tag-autocomplete */
  if (typeof document === "undefined") {
    React.useLayoutEffect = React.useEffect;
  }

  const [selected, setSelected] = useState<Tag[]>(
    defaultSelected && defaultSelected?.length > 0
      ? defaultSelected.map((item) => ({
          label: item[labelKey] as string,
          value: item[valueKey] as string,
        }))
      : []
  );

  const suggestions = useMemo(
    () =>
      items.map((item) => ({
        label: item[labelKey] as string,
        value: item[valueKey] as string,
      })),
    [items, labelKey, valueKey]
  );

  const onAdd = useCallback(
    (newTag: Tag) => {
      setSelected([...selected, newTag]);
    },
    [selected]
  );

  const onDelete = useCallback(
    (tagIndex: number) => {
      setSelected(selected.filter((_, i) => i !== tagIndex));
    },
    [selected]
  );

  return (
    <>
      <input
        type="hidden"
        name={name}
        value={selected.map((tag) => tag.value).join(",")}
        disabled={disabled}
      />

      <div className={tw("flex min-w-48 flex-col gap-1", className)}>
        <div className="flex items-center justify-between">
          <InnerLabel>{label}</InnerLabel>

          <When truthy={!!tooltip}>
            <Tooltip>
              <TooltipTrigger>
                <InfoIcon className="size-4 text-gray-500" />
              </TooltipTrigger>

              <TooltipContent className="max-w-xs">
                <h6>{tooltip?.title}</h6>
                <p className="text-sm text-gray-600">{tooltip?.content}</p>
              </TooltipContent>
            </Tooltip>
          </When>
        </div>

        <ReactTags
          isDisabled={disabled}
          labelText={`Select ${label}`}
          selected={selected}
          suggestions={suggestions}
          onAdd={onAdd}
          onDelete={onDelete}
          noOptionsText={`No matching ${label}`}
          placeholderText={placeholder}
          isInvalid={!!error}
          renderRoot={({ children, isDisabled }) => (
            <div
              className={tw(
                "relative w-full max-w-full rounded border border-gray-300 text-base text-gray-900 shadow outline-none placeholder:text-gray-900 focus:border-primary-300 focus:ring-0",
                isDisabled &&
                  "cursor-not-allowed border-gray-300 bg-gray-50 placeholder:text-gray-300",
                selected.length === 0 ? "px-3.5 py-2" : "px-3.5 py-1.5"
              )}
            >
              {children}
            </div>
          )}
          renderInput={({ ...props }) => (
            <input
              {..._.omit(props, ["inputWidth", "classNames"])}
              className="border-none bg-transparent p-0 text-base outline-none focus:outline-none focus:ring-0 disabled:placeholder:text-gray-300"
              disabled={disabled}
            />
          )}
        />

        <When truthy={!!error}>
          <p className="text-sm text-error-500">{error}</p>
        </When>
      </div>
    </>
  );
}
