/**
 * @deprecated This DropdownMenu component is deprecated and should not be used for new features.
 * Use Popover from @radix-ui/react-popover with custom select behavior instead.
 * See `app/components/assets/assets-index/advanced-filters/field-selector.tsx` for a good example.
 */
import * as React from "react";
import type {
  ComponentPropsWithoutRef,
  ElementRef,
  HTMLAttributes,
} from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
// import { Check, ChevronRight, Circle } from "lucide-react";

import { tw } from "~/utils/tw";
import { CheckIcon, ChevronRight } from "../icons/library";

const DropdownMenu = DropdownMenuPrimitive.Root;

const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

const DropdownMenuGroup = DropdownMenuPrimitive.Group;

const DropdownMenuPortal = DropdownMenuPrimitive.Portal;

const DropdownMenuSub = DropdownMenuPrimitive.Sub;

const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

const DropdownMenuSubTrigger = React.forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> & {
    inset?: boolean;
  }
>(function DropdownMenuSubTrigger(
  { className, inset, children, ...props },
  ref
) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      ref={ref}
      className={tw(
        "flex cursor-default select-none items-center rounded p-2 text-sm font-medium outline-none data-[state=open]:bg-gray-100 focus:bg-gray-100 ",
        inset && "pl-8",
        className
      )}
      {...props}
    >
      {children}
      <ChevronRight className="ml-auto size-4" />
    </DropdownMenuPrimitive.SubTrigger>
  );
});

const DropdownMenuSubContent = React.forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.SubContent>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(function DropdownMenuSubContent({ className, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.SubContent
      ref={ref}
      className={tw(
        "z-50 min-w-32 overflow-hidden rounded border border-slate-100 bg-white shadow-md animate-in  slide-in-from-left-1 ",
        className
      )}
      {...props}
    />
  );
});

const DropdownMenuContent = React.forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content> & {
    portalContainer?: HTMLElement;
  }
>(function DropdownMenuContent(
  {
    className,
    sideOffset = 4,
    collisionPadding = 16,
    portalContainer,
    ...props
  },
  ref
) {
  return (
    <DropdownMenuPrimitive.Portal container={portalContainer}>
      <DropdownMenuPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        // Capped at the viewport space Radix measures between the trigger and
        // the screen edge (minus `collisionPadding`, which keeps a gap there),
        // so a menu taller than that scrolls instead of running off-screen
        // with its last items unreachable.
        className={tw(
          " z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-32 overflow-y-auto rounded border border-gray-300 bg-white p-3 shadow-md animate-in data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2  data-[side=top]:slide-in-from-bottom-2",
          className
        )}
        {...props}
        // A modal Radix Dialog — every `Sheet`, and so every route rendered
        // through `ContextualSidebar` — mounts `react-remove-scroll`, which
        // cancels any `wheel` whose target sits outside the dialog content.
        // Portalled menu content counts as outside, so without this a long
        // menu cannot be scrolled by wheel inside a sheet; only dragging the
        // scrollbar works, since that is a pointer interaction rather than a
        // wheel event.
        //
        // React attaches portal listeners to the portal container, which is a
        // descendant of the `document` remove-scroll listens on, so stopping
        // here runs first and keeps the event alive.
        onWheel={(event) => {
          event.stopPropagation();
          props.onWheel?.(event);
        }}
        onTouchMove={(event) => {
          event.stopPropagation();
          props.onTouchMove?.(event);
        }}
      />
    </DropdownMenuPrimitive.Portal>
  );
});

/** The keys Radix treats as "select this item". */
const ITEM_SELECTION_KEYS = ["Enter", " "];

/** What counts as a row's own control: a link or a button inside the item. */
const ROW_CONTROL_SELECTOR = "a[href], button";

/**
 * How long a typed letter keeps the menu's type-ahead going. Radix clears its
 * search buffer one second after the last letter, and treats a Space inside
 * that window as part of the word, not as "select".
 */
const TYPEAHEAD_WINDOW_MS = 1000;

/** When a letter was last typed in any menu, for the type-ahead window. */
let lastTypeAheadAt = 0;

/**
 * Whether a key feeds the menu's type-ahead: one printable character other
 * than Space, with no modifier held.
 *
 * @param event - The keydown on the menu item
 */
function isTypeAheadKey(event: React.KeyboardEvent<HTMLElement>): boolean {
  return (
    event.key.length === 1 &&
    event.key !== " " &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  );
}

/**
 * Forwards Enter or Space on a menu row to the link or button inside it.
 *
 * Radix selects an item from the keyboard by clicking the item element itself,
 * and that click never reaches a control nested inside it. Most rows here put
 * their action on such a control (a `Button` with `onClick` or `to`, a dialog
 * trigger), so without this the keyboard does nothing on them. Clicking the
 * control instead does exactly what a mouse click does: its own handler runs,
 * then the click bubbles to the item and its `onSelect` runs once.
 *
 * A disabled control is not clicked and the row does nothing, the same as a
 * mouse click on it. A row with no inner control, or one that is itself the
 * control (`asChild` on a link or button), keeps Radix's own handling.
 *
 * @param event - The keydown on the menu item
 */
function forwardSelectionToRowControl(event: React.KeyboardEvent<HTMLElement>) {
  if (!ITEM_SELECTION_KEYS.includes(event.key)) return;
  const item = event.currentTarget;
  // Only keys pressed on the row itself: a key inside a nested field is its own.
  if (event.target !== item || item.matches(ROW_CONTROL_SELECTOR)) return;
  const control = item.querySelector<HTMLElement>(ROW_CONTROL_SELECTOR);
  if (!control) return;
  // Stops Radix clicking the item as well, which would select the row twice.
  event.preventDefault();
  const isDisabled =
    control.matches(":disabled") ||
    control.getAttribute("aria-disabled") === "true";
  if (!isDisabled) control.click();
}

/**
 * A menu row. Enter and Space do what clicking the row's own link or button
 * does (see {@link forwardSelectionToRowControl}); a row with no inner control
 * behaves as a plain Radix item.
 */
const DropdownMenuItem = React.forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.Item>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    inset?: boolean;
  }
>(function DropdownMenuItem(
  { className, inset, disabled = false, onKeyDown, ...props },
  ref
) {
  return (
    <DropdownMenuPrimitive.Item
      ref={ref}
      className={tw(
        "relative flex cursor-default select-none items-center px-2 py-1.5 text-sm font-medium outline-none  focus:bg-slate-100 ",
        inset && "pl-8",
        disabled && "pointer-events-none cursor-not-allowed opacity-50",
        className
      )}
      // Radix runs its own keydown handler after this one, and skips it once
      // `preventDefault()` has been called.
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (isTypeAheadKey(event)) {
          lastTypeAheadAt = Date.now();
          return;
        }
        // A Space while typing ahead continues the search (Radix handles it).
        if (
          event.key === " " &&
          Date.now() - lastTypeAheadAt < TYPEAHEAD_WINDOW_MS
        ) {
          return;
        }
        // `disabled` is not handed to Radix (it would drop the row from roving
        // focus), so stop the keyboard here, the way the class stops the mouse.
        if (disabled && ITEM_SELECTION_KEYS.includes(event.key)) {
          event.preventDefault();
          return;
        }
        forwardSelectionToRowControl(event);
      }}
      {...props}
    />
  );
});

const DropdownMenuCheckboxItem = React.forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(function DropdownMenuCheckboxItem(
  { className, children, checked, ...props },
  ref
) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      ref={ref}
      className={tw(
        "relative flex cursor-default select-none items-center rounded px-2 py-1.5 text-sm font-medium outline-none  focus:bg-slate-100 ",
        className
      )}
      checked={checked}
      {...props}
    >
      {children}
      <span className="absolute right-2 flex  h-auto w-[18px] items-center justify-center text-primary">
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
    </DropdownMenuPrimitive.CheckboxItem>
  );
});

const DropdownMenuRadioItem = React.forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(function DropdownMenuRadioItem({ className, children, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.RadioItem
      ref={ref}
      className={tw(
        "relative flex cursor-default select-none items-center rounded-[4px] py-1.5 pl-8 pr-2 text-sm font-medium outline-none  focus:bg-slate-100",
        className
      )}
      {...props}
    >
      <span className="absolute left-2 flex size-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <div className="size-2 fill-current" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
});

const DropdownMenuLabel = React.forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.Label>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & {
    inset?: boolean;
  }
>(function DropdownMenuLabel({ className, inset, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Label
      ref={ref}
      className={tw(
        "px-2 py-1.5 text-sm font-semibold ",
        inset && "pl-8",
        className
      )}
      {...props}
    />
  );
});

const DropdownMenuSeparator = React.forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.Separator>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(function DropdownMenuSeparator({ className, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Separator
      ref={ref}
      className={tw("-mx-1 my-1 h-px bg-slate-100 ", className)}
      {...props}
    />
  );
});

const DropdownMenuShortcut = ({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) => (
  <span
    className={tw("ml-auto text-xs tracking-widest ", className)}
    {...props}
  />
);
DropdownMenuShortcut.displayName = "DropdownMenuShortcut";

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
};
