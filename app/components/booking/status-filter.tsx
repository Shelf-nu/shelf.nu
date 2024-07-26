import { useNavigation, useSearchParams } from "@remix-run/react";
import { useCookieDestroy } from "~/hooks/use-search-param-utils";
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
}: {
  statusItems: Record<string, string>;
}) {
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);
  const [searchParams, setSearchParams] = useSearchParams();
  const status = searchParams.get("status");
  const { destroyCookieValues } = useCookieDestroy();

  function handleValueChange(value: string) {
    setSearchParams((prev) => {
      /** If the value is "ALL", we just remove the param */
      if (value === "ALL") {
        //make sure this is added where-ever we are explicitly delteting the searchaprams manually.
        destroyCookieValues(["status"]);
        prev.delete("status");
        return prev;
      }
      prev.set("status", value);
      return prev;
    });
  }

  return (
    <div className="w-full md:w-auto">
      <Select
        name={`status`}
        defaultValue={status ? status : "ALL"}
        onValueChange={handleValueChange}
        disabled={disabled}
      >
        <SelectTrigger className="mt-2 px-3.5 py-2 text-left text-base text-gray-500 md:mt-0 md:max-w-fit">
          <SelectValue placeholder={`Filter by status`} />
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
