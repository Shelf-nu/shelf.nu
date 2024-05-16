import type { ModelFilterItem } from "~/hooks/use-model-filters";

export function transformItemUsingTransformer(
  items: ModelFilterItem[],
  transformer?: (item: ModelFilterItem) => ModelFilterItem
): Array<ModelFilterItem> {
  return items.map((item) => {
    /**
     * Transforming the data based on user's provided transformer function
     */
    const transformedItem =
      typeof transformer === "function" ? transformer(item) : item;

    return transformedItem;
  });
}
