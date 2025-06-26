import { useSearchParams } from "~/hooks/search-params";
import { useDisabled } from "~/hooks/use-disabled";
import { tw } from "~/utils/tw";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../forms/select";

type SelectItem = {
  label: string;
  value: string;
};

type SelectWithSearchParamsProps = {
  className?: string;

  /**
   * The items to display in the select dropdown.
   */
  items: SelectItem[];

  /**
   * The name of the search parameter to use for the select.
   */
  name: string;

  /**
   * The default value to use if the search parameter is not set.
   */
  defaultValue?: string;

  /**
   * Optional placeholder for the select input.
   */
  placeholder?: string;
};

export default function SelectWithSearchParams({
  className,
  items,
  name,
  defaultValue = "ALL",
  placeholder = "Select an option",
}: SelectWithSearchParamsProps) {
  const disabled = useDisabled();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedValue = searchParams.get("name") || defaultValue;

  function handleValueChange(value: string) {
    setSearchParams((prev) => {
      /* If the value is defaultValue, we just remove the param. */
      if (value === defaultValue) {
        prev.delete(name);
        return prev;
      }

      prev.set(name, value);
      return prev;
    });
  }

  return (
    <Select
      name={name}
      defaultValue={selectedValue}
      onValueChange={handleValueChange}
      disabled={disabled}
    >
      <SelectTrigger className="px-3.5 py-2 text-left text-base text-gray-500 md:mt-0 md:max-w-fit">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>

      <SelectContent
        position="popper"
        className={tw("w-full min-w-72 overflow-auto p-0", className)}
      >
        {items.map((item) => (
          <SelectItem
            key={item.value}
            value={item.value}
            className="rounded-none border-b border-gray-200 px-6 py-4 pr-1.5 text-gray-700 hover:bg-gray-50"
          >
            <span className="mr-4 text-sm">{item.label}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
