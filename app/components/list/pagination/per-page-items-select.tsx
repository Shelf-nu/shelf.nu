import { useLoaderData, useSearchParams } from "@remix-run/react";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "~/components/forms/select";
import type { loader } from "~/routes/_layout+/assets._index";

export default function PerPageItemsSelect() {
  const perPageValues = ["20", "50", "100"];
  const [_, setSearchParams] = useSearchParams();
  const { perPage } = useLoaderData<typeof loader>();

  function onValueChange(value: string) {
    setSearchParams((prev) => {
      /** We remove the current page when changing per-page. */
      prev.delete("page");
      prev.set("per_page", value);
      return prev;
    });
  }

  return (
    <div className="relative">
      <Select
        name="per_page"
        defaultValue={perPage.toString()}
        onValueChange={onValueChange}
      >
        <SelectTrigger className="h-[40px] px-3 py-[8.5px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="w-[250px]" position="popper" align="start">
          <div className=" max-h-[320px] overflow-auto">
            {perPageValues.map((value) => (
              <SelectItem value={value} key={value}>
                <span className="mr-4 text-[14px] font-semibold text-gray-700">
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
