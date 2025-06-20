import React, { useCallback, useMemo, useState } from "react";
import { ReactTags } from "react-tag-autocomplete";
import type { Tag } from "react-tag-autocomplete";
import { tw } from "~/utils/tw";
import { InnerLabel } from "../forms/inner-label";

type MultiSelectProps<T> = {
  className?: string;
  items: T[];
  labelKey: keyof T;
  valueKey: keyof T;
  name: string;
  label?: string;
  defaultSelected?: T[];
  disabled?: boolean;
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

      <div className={tw("flex flex-col gap-1", className)}>
        <InnerLabel>{label}</InnerLabel>
        <ReactTags
          isDisabled={disabled}
          labelText={`Select ${label}`}
          selected={selected}
          suggestions={suggestions}
          onAdd={onAdd}
          onDelete={onDelete}
          noOptionsText={`No matching ${label}`}
          placeholderText={`Select ${label}`}
        />
      </div>
    </>
  );
}
