import { useMemo } from "react";
import _ from "lodash";
import invariant from "tiny-invariant";
import { useSearchParams } from "~/hooks/search-params";
import { tw } from "~/utils/tw";
import {
  Select as InternalSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../forms/select";

type SearchParamsStrategy = {
  strategy: "searchParams";
  paramKey: string;
};

type ManualStrategy = {
  defaultValue?: string;
  strategy: "manual";
  onSelect: (value: string) => void;
};

type Strategy = SearchParamsStrategy | ManualStrategy;

type SelectProps<TItem extends Record<string, unknown>> = Strategy & {
  className?: string;
  placeholder?: string;

  /** Array of items to render in select component */
  items: TItem[];

  /** A key in your object to get the label for select. It can also retrieve a nested value in object like `item.nested.label`  */
  labelKey: keyof TItem | string;

  /** A key in your object to get the value for select. It can also retrieve a nested value in object like `item.nested.value` */
  valueKey: keyof TItem | string;
};

export default function Select<T extends Record<string, unknown>>({
  className,
  placeholder = "Select item",
  items,
  labelKey,
  valueKey,
  ...strategyProps
}: SelectProps<T>) {
  const [searchParams, setSearchParams] = useSearchParams();

  const defaultValue =
    strategyProps.strategy === "searchParams"
      ? searchParams.get(strategyProps.paramKey) ?? undefined
      : strategyProps.defaultValue;

  const itemsToRender = useMemo(
    () =>
      items.map((item) => {
        const label = _.get(item, labelKey);
        invariant(typeof label === "string", "Label is not string type");

        const value = _.get(item, valueKey);
        invariant(typeof value === "string", "Value is not string type");

        return {
          label,
          value,
        };
      }),
    [items, labelKey, valueKey]
  );

  function handleValueChange(value: string) {
    if (strategyProps.strategy === "searchParams") {
      setSearchParams((prev) => {
        prev.set(strategyProps.paramKey, value);
        return prev;
      });
    } else {
      strategyProps.onSelect(value);
    }
  }

  return (
    <InternalSelect
      defaultValue={defaultValue}
      onValueChange={handleValueChange}
    >
      <SelectTrigger className={tw("w-max gap-2", className)}>
        <SelectValue className="w-max" placeholder={placeholder} />
      </SelectTrigger>

      <SelectContent>
        {itemsToRender.map((item) => (
          <SelectItem key={item.value} value={item.value} className="px-4 py-2">
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </InternalSelect>
  );
}
