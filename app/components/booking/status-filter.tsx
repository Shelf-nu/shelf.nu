import { useNavigation } from "@remix-run/react";
import { useSearchParams } from "~/hooks/search-params";
import { isFormProcessing } from "~/utils/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../forms/select";

export function StatusFilter({
  statusItems,
  name = "status",
}: {
  statusItems: Record<string, string>;
  /**
   * By default the name of the field is status,
   * but it can cause conflicts if a parent and child route both use the name status
   * for filtering but they have different status types */
  name?: string;
}) {
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);
  const [searchParams, setSearchParams] = useSearchParams();
  const status = searchParams.get(name);

  function handleValueChange(value: string) {
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

  return (
    <div className="w-full md:w-auto">
      <Select
        name={name}
        defaultValue={status ? status : "ALL"}
        onValueChange={handleValueChange}
        disabled={disabled}
      >
        <SelectTrigger
          aria-label="Filter by status"
          className="mt-2 px-3.5 py-2 text-left text-base text-gray-500 md:mt-0 md:max-w-fit"
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
                className="rounded-none border-b border-gray-200 px-6 py-4 pr-[5px]"
              >
                <span className="mr-4 block text-[14px] lowercase text-gray-700 first-letter:uppercase">
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
