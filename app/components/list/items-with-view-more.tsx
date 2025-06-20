import _ from "lodash";
import { tw } from "~/utils/tw";
import { GrayBadge } from "../shared/gray-badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../shared/tooltip";

type PropsWithRenderItem<T> = {
  renderItem: (item: T) => React.ReactNode;
};

type PropsWithoutRenderItem<T> = {
  /**
   * The key to use for the label of each item.
   * If `renderItem` is not provided, this key will be used to access the label property of each item.
   */
  labelKey: keyof T;

  /**
   * The key to use for the unique identifier of each item.
   * This is used as the `key` prop in React when rendering the items.
   */
  idKey: keyof T;

  renderItem?: undefined;
};

type MergedProps<T> = PropsWithRenderItem<T> | PropsWithoutRenderItem<T>;

type ItemsWithViewMoreProps<T> = MergedProps<T> & {
  items: T[];
  showCount?: number;
  className?: string;
  emptyMessage?: string | React.ReactNode;
};

export default function ItemsWithViewMore<T>({
  className,
  items,
  showCount = 2,
  emptyMessage = "No items",
  ...restProps
}: ItemsWithViewMoreProps<T>) {
  // Filter out any null/undefined items first
  const filteredItems = items.filter(Boolean);

  // Show only first `showCount` items
  const visibleItems = filteredItems.slice(0, showCount);
  const remainingItems = filteredItems.slice(showCount);

  function itemRenderer(item: T) {
    if (typeof restProps.renderItem === "function") {
      return restProps.renderItem(item);
    }

    return (
      <GrayBadge key={_.get(item, restProps.idKey)}>
        {_.get(item, restProps.labelKey)}
      </GrayBadge>
    );
  }

  if (filteredItems.length === 0) {
    return <div>{emptyMessage}</div>;
  }

  return (
    <div className={tw("flex items-center gap-2 text-right", className)}>
      {visibleItems.map((item) => itemRenderer(item))}

      {remainingItems.length > 0 ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>
              <GrayBadge>{`+${filteredItems.length - showCount}`}</GrayBadge>
            </TooltipTrigger>

            <TooltipContent side="top" className="max-w-72">
              {remainingItems.map((item) => itemRenderer(item))}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : null}
    </div>
  );
}
