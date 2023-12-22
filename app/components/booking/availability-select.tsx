import { useMemo } from "react";
import { useSearchParams } from "@remix-run/react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../forms";

export function AvailabilitySelect() {
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
    <div>
      <Select
        name="category"
        defaultValue={defaultValue}
        onValueChange={handleSelectChange}
      >
        <SelectTrigger className="">
          <SelectValue placeholder="Select category" />
        </SelectTrigger>

        <div>
          <SelectContent
            className=" w-[350px]"
            position="popper"
            align="end"
            sideOffset={4}
          >
            <div className="border-b border-b-gray-300 py-2 ">
              <SelectItem value={"show"} key={"show"}>
                <span className="whitespace-nowrap">All assets</span>
              </SelectItem>
              <SelectItem value={"hide"} key={"hide"}>
                <span className="whitespace-nowrap">Hide unavailable</span>
              </SelectItem>
            </div>
          </SelectContent>
        </div>
      </Select>
    </div>
  );
}
