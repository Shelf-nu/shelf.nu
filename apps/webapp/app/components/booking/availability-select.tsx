import { useMemo } from "react";
import { useSearchParams } from "~/hooks/search-params";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../forms/select";

export function AvailabilitySelect({ label = "assets" }: { label?: string }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const hideUnavailable = searchParams.get("hideUnavailable");

  /**
   * Logic:
   * 1. If no param is present, show all
   * 2. If hideUnavailable is present check if it's true or false
   */
  const defaultValue = useMemo(() => {
    if (!hideUnavailable) return "show";
    return hideUnavailable === "true" ? "hide" : "show";
  }, [hideUnavailable]);

  function handleSelectChange(value: string) {
    setSearchParams((prev) => {
      prev.set("hideUnavailable", value === "show" ? "false" : "true");
      return prev;
    });
  }

  return (
    <Select
      name="hideUnavailable"
      defaultValue={defaultValue}
      onValueChange={handleSelectChange}
    >
      <SelectTrigger
        className="text-left text-base text-color-500 md:mt-0 md:max-w-fit"
        aria-label="Select availability"
      >
        <SelectValue placeholder="Select availability" />
      </SelectTrigger>

      <SelectContent
        className=" w-full min-w-[250px] p-0"
        position="popper"
        align="end"
        sideOffset={4}
      >
        <div className="max-h-[320px] overflow-auto">
          <SelectItem
            value={"show"}
            key={"show"}
            className="rounded-none border-b border-color-200 px-6 py-4 pr-[5px]"
          >
            <span className="mr-4 block lowercase text-color-700 first-letter:uppercase">
              All {label}
            </span>
          </SelectItem>
          <SelectItem
            value={"hide"}
            key={"hide"}
            className="rounded-none border-b border-color-200 px-6 py-4 pr-[5px]"
          >
            <span className="mr-4 block lowercase text-color-700 first-letter:uppercase">
              Hide unavailable
            </span>
          </SelectItem>
        </div>
      </SelectContent>
    </Select>
  );
}
