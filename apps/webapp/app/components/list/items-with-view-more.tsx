/**
 * Items With View More
 *
 * Shows the first few items of a list inline and folds the rest behind a
 * "+N" chip. Plain items fold into a tooltip; items that are links fold into a
 * popover, which keyboard users can open and move through.
 *
 * @see {@link file://./../assets/assets-index/list-item-tags-column.tsx}
 */
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import get from "lodash/get";
import { tw } from "~/utils/tw";
import { GrayBadge } from "../shared/gray-badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../shared/tooltip";

type PropsWithRenderItem<T> = {
  renderItem: (item: T) => ReactNode;
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
  emptyMessage?: string | ReactNode;
  /**
   * The items are links or controls. The hidden ones then open in a popover
   * (hover, click or Enter) that stays open while focus moves through it; a
   * tooltip closes as soon as focus leaves the "+N" chip.
   */
  interactive?: boolean;
};

export default function ItemsWithViewMore<T>({
  className,
  items,
  showCount = 2,
  emptyMessage = "No items",
  interactive = false,
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
      <GrayBadge key={get(item, restProps.idKey)}>
        {get(item, restProps.labelKey)}
      </GrayBadge>
    );
  }

  if (filteredItems.length === 0) {
    return <div>{emptyMessage}</div>;
  }

  return (
    <div className={tw("flex items-center gap-2 text-right", className)}>
      {visibleItems.map((item) => itemRenderer(item))}

      {remainingItems.length > 0 && interactive ? (
        <MoreItemsPopover label={`+${filteredItems.length - showCount}`}>
          {remainingItems.map((item) => itemRenderer(item))}
        </MoreItemsPopover>
      ) : remainingItems.length > 0 ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>
              <GrayBadge>{`+${filteredItems.length - showCount}`}</GrayBadge>
            </TooltipTrigger>

            <TooltipContent
              side="top"
              className="flex max-w-72 flex-wrap items-center gap-2"
            >
              {remainingItems.map((item) => itemRenderer(item))}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : null}
    </div>
  );
}

/**
 * The "+N" chip for interactive items: a popover that opens on hover like the
 * tooltip it replaces, and also on click or Enter so keyboard users can reach
 * the links inside.
 *
 * Opened by a press, focus moves to the first link so Enter follows it right
 * away. Opened by hover, focus stays where it was: pointing at a chip must not
 * pull keyboard focus away from what the user was doing.
 */
function MoreItemsPopover({
  label,
  children,
}: {
  /** The chip text, e.g. "+3" */
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  /** Whether the current opening came from hovering the chip */
  const openedByHover = useRef(false);
  /** Set while the chip itself is being clicked or pressed with Enter/Space */
  const pressingChip = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);
  /** Pending close after the pointer leaves the chip, cancelled on reaching the content */
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function cancelClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }

  function focusFirstItem() {
    contentRef.current?.querySelector<HTMLElement>("a, button")?.focus();
  }

  function handleOpenChange(next: boolean) {
    const pressed = pressingChip.current;
    pressingChip.current = false;
    // Pressing the chip while hover holds the popover open would toggle it
    // shut; treat the press as "let me in" instead.
    if (!next && pressed && openedByHover.current) {
      openedByHover.current = false;
      focusFirstItem();
      return;
    }
    if (next) openedByHover.current = false;
    setOpen(next);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        type="button"
        aria-label={`Show ${label.slice(1)} more`}
        onPointerDown={() => {
          pressingChip.current = true;
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            pressingChip.current = true;
          }
        }}
        onMouseEnter={() => {
          cancelClose();
          if (open) return;
          openedByHover.current = true;
          setOpen(true);
        }}
        onMouseLeave={() => {
          // Only a hover opening closes on leave; a pressed one stays until
          // Escape or a click outside. The delay lets the pointer cross the
          // gap into the content.
          if (!openedByHover.current) return;
          closeTimer.current = setTimeout(() => setOpen(false), 150);
        }}
        className="rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        <GrayBadge>{label}</GrayBadge>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          side="top"
          sideOffset={6}
          onMouseEnter={cancelClose}
          onMouseLeave={() => {
            if (openedByHover.current) setOpen(false);
          }}
          ref={contentRef}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            if (!openedByHover.current) focusFirstItem();
          }}
          className="z-50 flex max-w-72 flex-wrap items-center gap-2 rounded-md border bg-white p-3 text-sm font-medium shadow-lg"
        >
          {children}
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}
