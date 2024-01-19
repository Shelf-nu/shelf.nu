import { BookingStatus } from "@prisma/client";
import { useSearchParams } from "@remix-run/react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../forms";

export function StatusFilter() {
  const [searchParams, setSearchParams] = useSearchParams();
  const status = searchParams.get("status");

  function handleValueChange(value: string) {
    setSearchParams((prev) => {
      /** If the value is "ALL", we just remove the param */
      if (value === "ALL") {
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
      >
        <SelectTrigger className="mt-2 px-3.5 py-3 md:mt-0 md:max-w-fit">
          <SelectValue placeholder={`Filter by asset status`} />
        </SelectTrigger>
        <SelectContent
          position="popper"
          className="w-full min-w-[300px] p-0"
          align="start"
        >
          <div className=" max-h-[320px] overflow-auto">
            {["ALL", ...Object.values(BookingStatus)].map((value) => (
              <SelectItem
                value={value}
                key={value}
                className="rounded-none border-b border-gray-200 px-6 py-4 pr-[5px]"
              >
                <span className="mr-4 block text-[14px] lowercase text-gray-700 first-letter:uppercase">
                  {value}
                </span>
              </SelectItem>
            ))}
          </div>
        </SelectContent>
      </Select>
    </div>
  );
}
