import type { ModelFilterItem } from "~/hooks/use-model-filters";

export function itemsWithExtractedValue(
  items: ModelFilterItem[],
  valueExtractor?: (item: ModelFilterItem) => string
): Array<ModelFilterItem> {
  return items.map((item) => {
    const id =
      typeof valueExtractor === "function" ? valueExtractor(item) : item.id;

    return {
      ...item,
      id,
    };
  });
}
