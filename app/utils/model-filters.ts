import type {
  ModelFilterItem,
  ModelFilterProps,
} from "~/hooks/use-model-filters";

export function transformItemUsingTransformer(
  items: ModelFilterItem[],
  transformer?: (item: ModelFilterItem) => ModelFilterItem,
  withoutValueItem?: ModelFilterProps["withoutValueItem"]
): Array<ModelFilterItem> {
  const transformedItems = items.map((item) => {
    /**
     * Transforming the data based on user's provided transformer function
     */
    const transformedItem =
      typeof transformer === "function" ? transformer(item) : item;

    return transformedItem;
  });

  /** Adding the value at the start of array so it is displayed at top */
  if (withoutValueItem) {
    transformedItems.unshift({
      id: withoutValueItem.id,
      name: withoutValueItem.name,
      metadata: withoutValueItem,
    });
  }

  return transformedItems;
}
