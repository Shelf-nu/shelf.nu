import { useLoaderData } from "react-router";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "~/components/forms/select";
import { useSearchParams } from "~/hooks/search-params";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";
import { PER_PAGE_OPTIONS } from "~/utils/per-page";

export default function PerPageItemsSelect() {
  const perPageValues = PER_PAGE_OPTIONS.map(String);
  const [_, setSearchParams] = useSearchParams();
  const { perPage } = useLoaderData<AssetIndexLoaderData>();

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
        <SelectTrigger
          aria-label="Select per page"
          className="h-[34px] px-3 py-[5.5px] text-[14px]"
        >
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
