import { useNavigation } from "react-router";
import { useSearchParams } from "~/hooks/search-params";
import { isFormProcessing } from "~/utils/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../forms/select";

// Base props that are always available
type BaseStatusFilterProps = {
  statusItems: Record<string, string>;
  name?: string;
};

// When defaultValue is provided, onValueChange is required
type StatusFilterWithCustomDefault = BaseStatusFilterProps & {
  defaultValue: string;
  onValueChange: (value: string) => void;
};

// When defaultValue is not provided, onValueChange is optional (uses internal handler)
type StatusFilterWithDefaultBehavior = BaseStatusFilterProps & {
  defaultValue?: never;
  onValueChange?: never;
};

// Union type for the component props
type StatusFilterProps =
  | StatusFilterWithCustomDefault
  | StatusFilterWithDefaultBehavior;

export function StatusFilter(props: StatusFilterProps) {
  const { statusItems, name = "status", defaultValue, onValueChange } = props;
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);
  const [searchParams, setSearchParams] = useSearchParams();
  const status = searchParams.get(name);

  function localHandleValueChange(value: string) {
    setSearchParams((prev) => {
      /** If the value is "ALL", we just remove the param */
      if (value === "ALL") {
        prev.delete(name);
        return prev;
      }
      prev.set(name, value);
      return prev;
    });
  }

  // Use custom handler if provided, otherwise use local handler
  const handleValueChange = onValueChange || localHandleValueChange;

  // Use custom default if provided, otherwise use "ALL"
  const effectiveDefaultValue = defaultValue || "ALL";

  return (
    <div className="w-full md:w-auto">
      <Select
        name={name}
        defaultValue={status ? status : effectiveDefaultValue}
        onValueChange={handleValueChange}
        disabled={disabled}
      >
        <SelectTrigger
          aria-label="Filter by status"
          className="mt-2 px-3.5 py-2 text-left text-base text-color-500 md:mt-0 md:max-w-fit"
        >
          <SelectValue placeholder="Filter by status" />
        </SelectTrigger>
        <SelectContent
          position="popper"
          className="w-full min-w-[300px] p-0"
          align="start"
        >
          <div className=" max-h-[320px] overflow-auto">
            {["ALL", ...Object.values(statusItems)].map((value) => (
              <SelectItem
                value={value}
                key={value}
                className="rounded-none border-b border-color-200 px-6 py-4 pr-[5px]"
              >
                <span className="mr-4 block text-[14px] lowercase text-color-700 first-letter:uppercase">
                  {value.split("_").join(" ")}
                </span>
              </SelectItem>
            ))}
          </div>
        </SelectContent>
      </Select>
    </div>
  );
}
