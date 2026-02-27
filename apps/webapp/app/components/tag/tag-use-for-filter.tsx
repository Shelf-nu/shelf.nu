import { TagUseFor } from "@prisma/client";
import { useSearchParams } from "~/hooks/search-params";
import { useDisabled } from "~/hooks/use-disabled";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../forms/select";

export default function TagUseForFilter() {
  const disabled = useDisabled();
  const [searchParams, setSearchParams] = useSearchParams();

  const useFor = searchParams.get("useFor") ?? "ALL";

  function handleValueChange(value: string) {
    setSearchParams((prev) => {
      /** If the value is 'ALL', we just remove the param  */
      if (value === "ALL") {
        prev.delete("useFor");
        return prev;
      }

      prev.set("useFor", value);
      return prev;
    });
  }

  return (
    <Select
      name="useFor"
      defaultValue={useFor}
      onValueChange={handleValueChange}
      disabled={disabled}
    >
      <SelectTrigger
        aria-label="Filter by usage"
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
          {["ALL", ...Object.values(TagUseFor)].map((value) => (
            <SelectItem
              value={value}
              key={value}
              className="rounded-none border-b border-color-200 px-6 py-4 pr-[5px]"
            >
              <span className="mr-4 block text-[14px] lowercase text-color-700 first-letter:uppercase">
                {value}
              </span>
            </SelectItem>
          ))}
        </div>
      </SelectContent>
    </Select>
  );
}
