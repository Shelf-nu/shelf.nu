import * as React from "react";
import type { ComponentPropsWithoutRef, ElementRef } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { tw } from "~/utils/tw";
import { CheckIcon, ChevronRight } from "../icons/library";
import When from "../when/when";

const Select = SelectPrimitive.Root;

const SelectGroup = SelectPrimitive.Group;

const SelectValue = SelectPrimitive.Value;

const SelectTrigger = React.forwardRef<
  ElementRef<typeof SelectPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger> & {
    hideArrow?: boolean;
  }
>(function SelectTrigger(
  { className, children, hideArrow = false, ...props },
  ref
) {
  return (
    <SelectPrimitive.Trigger
      ref={ref}
      className={tw(
        "select-trigger flex w-full touch-manipulation items-center justify-between rounded border border-gray-300 bg-white px-3 py-2 text-[16px] text-gray-500 placeholder:text-gray-500 focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-25 focus:ring-offset-2 disabled:opacity-50 ",
        className
      )}
      {...props}
    >
      {children}

      <When truthy={!hideArrow}>
        <ChevronRight className="rotate-90" />
      </When>
    </SelectPrimitive.Trigger>
  );
});

const SelectContent = React.forwardRef<
  ElementRef<typeof SelectPrimitive.Content>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(function SelectContent({ className, children, ...props }, _ref) {
  /**
   * Track the rendered Radix Content element in state so the touchend listener
   * can be attached and cleaned up via a real `useEffect`. Using a callback
   * ref's return value for cleanup is fragile — handle the lifecycle
   * explicitly instead.
   *
   * why passive:false — the handler needs preventDefault() to stop the iOS
   * Safari synthetic-click that Radix Select otherwise fires when the user
   * taps the content's padding/empty area; passive:true would make
   * preventDefault a no-op.
   *
   * why the role="option" / button / input bail-out — preventing default on
   * touchend over an interactive descendant cancels the synthetic click that
   * iOS Safari fires for that tap. Radix selects on pointerup, but several
   * focus / aria-activedescendant transitions in Radix Select still rely on
   * the click event firing. Suppressing it intermittently breaks selection
   * on iPhone/iPad — the original report behind these fixes.
   */
  const [contentEl, setContentEl] = React.useState<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!contentEl) return;
    const handler = (event: TouchEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          '[role="option"], [data-radix-select-item], button, a, input, select, textarea, [role="checkbox"], [role="menuitem"]'
        )
      ) {
        return;
      }
      event.preventDefault();
    };
    contentEl.addEventListener("touchend", handler, { passive: false });
    return () => {
      contentEl.removeEventListener("touchend", handler);
    };
  }, [contentEl]);

  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={setContentEl}
        className={tw(
          " relative z-[200] overflow-hidden rounded border border-gray-300 bg-white p-3 shadow-md animate-in fade-in-80",
          className
        )}
        {...props}
      >
        <SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
});

const SelectLabel = React.forwardRef<
  ElementRef<typeof SelectPrimitive.Label>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(function SelectLabel({ className, ...props }, ref) {
  return (
    <SelectPrimitive.Label
      ref={ref}
      className={tw(
        "text-md py-1.5 pl-8 pr-2 font-medium text-gray-700",
        className
      )}
      {...props}
    />
  );
});

const SelectItem = React.forwardRef<
  ElementRef<typeof SelectPrimitive.Item>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(function SelectItem({ className, children, ...props }, ref) {
  return (
    <SelectPrimitive.Item
      ref={ref}
      className={tw(
        "relative flex min-h-[40px] cursor-default touch-manipulation select-none items-center rounded p-1 text-sm font-medium outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 focus:bg-gray-50 md:min-h-0 ",
        className
      )}
      {...props}
    >
      <div className="flex w-full items-center justify-between">
        <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>

        <span className="mr-[10px] flex size-3.5 h-auto w-[18px] items-center justify-center text-primary">
          <SelectPrimitive.ItemIndicator>
            <CheckIcon />
          </SelectPrimitive.ItemIndicator>
        </span>
      </div>
    </SelectPrimitive.Item>
  );
});

const SelectSeparator = React.forwardRef<
  ElementRef<typeof SelectPrimitive.Separator>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(function SelectSeparator({ className, ...props }, ref) {
  return (
    <SelectPrimitive.Separator
      ref={ref}
      className={tw("-mx-1 my-1 h-px bg-slate-100 ", className)}
      {...props}
    />
  );
});

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
};
