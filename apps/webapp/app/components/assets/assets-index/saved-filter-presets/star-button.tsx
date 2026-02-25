import { Star } from "lucide-react";
import { useFetcher } from "react-router";
import { isFormProcessing } from "~/utils/form";
import type { NormalizedPreset } from "./preset-list-item";

/**
 * Star button component for toggling preset starred state.
 *
 * Uses optimistic UI - the star appears filled/unfilled immediately when clicked,
 * and reverts if the server action fails.
 *
 * @param preset - The preset to star/unstar
 */
export function StarButton({ preset }: { preset: NormalizedPreset }) {
  // Use unique fetcher key per preset to allow concurrent star requests
  const starFetcher = useFetcher({ key: `toggle-star-${preset.id}` });

  // Check if this specific preset is being starred via optimistic update
  const isStarring =
    isFormProcessing(starFetcher.state) &&
    starFetcher.formData?.get("presetId") === preset.id;

  // Optimistic starred state: use formData if available, otherwise use preset.starred
  const optimisticStarred = isStarring
    ? starFetcher.formData?.get("starred") === "true"
    : preset.starred;

  return (
    <starFetcher.Form method="post">
      <input type="hidden" name="intent" value="toggle-star-preset" />
      <input type="hidden" name="presetId" value={preset.id} />
      <input type="hidden" name="starred" value={String(!preset.starred)} />
      <button
        type="submit"
        className="mt-0.5 text-gray-400 hover:text-yellow-500"
        title={optimisticStarred ? "Unstar" : "Star"}
        // why: Prevent form submission from bubbling and closing parent popover
        onClick={(e) => e.stopPropagation()}
      >
        <Star
          className={
            optimisticStarred
              ? "size-4 fill-yellow-500 text-yellow-500"
              : "size-4"
          }
        />
      </button>
    </starFetcher.Form>
  );
}
