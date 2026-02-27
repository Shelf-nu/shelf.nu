import React, { useCallback, useMemo, useState } from "react";
import _ from "lodash";
import { InfoIcon, X } from "lucide-react";
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
  hideLabel?: boolean;
  required?: boolean;
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
  hideLabel = false,
  required = false,
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

      <div className={tw("flex min-w-48 flex-col", className)}>
        <div className="flex items-center justify-between">
          <InnerLabel hideLg={hideLabel} required={required}>
            {label}
          </InnerLabel>

          <When truthy={!!tooltip}>
            <Tooltip>
              <TooltipTrigger>
                <InfoIcon className="size-4 text-color-500" />
              </TooltipTrigger>

              <TooltipContent className="max-w-xs">
                <h6>{tooltip?.title}</h6>
                <p className="text-sm text-color-600">{tooltip?.content}</p>
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
                "relative w-full max-w-full rounded border border-color-300 text-base text-color-900 shadow outline-none placeholder:text-color-900 focus:border-primary-300 focus:ring-0",
                isDisabled &&
                  "cursor-not-allowed border-color-300 bg-color-50 placeholder:text-color-300",
                selected.length === 0 ? "px-3.5 py-2" : "px-3.5 py-1.5"
              )}
            >
              {children}
            </div>
          )}
          renderInput={({ ...props }) => (
            <input
              {..._.omit(props, ["inputWidth", "classNames"])}
              className={tw(
                "border-none !bg-transparent p-0 text-base outline-none focus:outline-none focus:ring-0 disabled:placeholder:text-color-300"
              )}
              disabled={disabled}
            />
          )}
          renderTag={({ tag, ...props }) => (
            <span className="mb-1 inline-flex items-center justify-center rounded-2xl bg-muted px-[8px] py-[2px] text-center text-[12px] font-medium text-color-700">
              {tag.label}
              <button
                {...props}
                className="ml-1 inline-flex items-center justify-center rounded-full hover:bg-soft focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
                <X className="size-3" />
              </button>
            </span>
          )}
        />

        <When truthy={!!error}>
          <p className="text-sm text-error-500">{error}</p>
        </When>
      </div>
    </>
  );
}
