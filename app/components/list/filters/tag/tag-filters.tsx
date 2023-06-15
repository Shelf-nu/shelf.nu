import { useAtom, useAtomValue } from "jotai";
import { Button } from "~/components/shared";
import { TagCheckboxDropdown } from "./tag-checkbox-dropdown";
import { clearTagFiltersAtom, selectedTagsAtom } from "../atoms";

export const TagFilters = () => {
  const selectedTags = useAtomValue(selectedTagsAtom);
  const [, clearFilters] = useAtom(clearTagFiltersAtom);

  return (
    <div className="inline-flex  justify-end gap-2 p-3  md:p-0 lg:gap-4 ">
      {selectedTags.items.length > 0 ? (
        <>
          <Button
            as="button"
            onClick={clearFilters}
            variant="link"
            className="block max-w-none whitespace-nowrap text-xs  font-normal text-gray-500 hover:text-gray-600"
          >
            Clear filters
          </Button>
          <div className="text-gray-500"> | </div>
        </>
      ) : null}
      <div>
        <TagCheckboxDropdown />
      </div>
    </div>
  );
};
