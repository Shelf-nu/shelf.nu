import type { ModelFilterItem } from "~/hooks/use-model-filters";

export function transformItemUsingTransformer(
  items: ModelFilterItem[] | undefined,
  transformer?: (item: ModelFilterItem) => ModelFilterItem
): Array<ModelFilterItem> {
  if (!items) return [];
  return items.map((item) => {
    /**
     * Transforming the data based on user's provided transformer function
     */
    const transformedItem =
      typeof transformer === "function" ? transformer(item) : item;

    return transformedItem;
  });
}
