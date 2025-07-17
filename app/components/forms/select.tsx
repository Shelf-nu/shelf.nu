import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { tw } from "~/utils/tw";
import { CheckIcon, ChevronRight } from "../icons/library";
import When from "../when/when";

const Select = SelectPrimitive.Root;

const SelectGroup = SelectPrimitive.Group;

const SelectValue = SelectPrimitive.Value;

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger> & {
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
        "select-trigger flex w-full items-center justify-between rounded border border-color-300 bg-surface px-3 py-2 text-[16px] text-color-500 placeholder:text-color-500 focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-25 focus:ring-offset-2 disabled:opacity-50 ",
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
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(function SelectContent({ className, children, ...props }, _ref) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={(ref) =>
          ref?.addEventListener("touchend", (e) => e.preventDefault())
        }
        className={tw(
          " relative z-50 overflow-hidden rounded border border-color-300 bg-surface p-3 shadow-md animate-in fade-in-80",
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
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(function SelectLabel({ className, ...props }, ref) {
  return (
    <SelectPrimitive.Label
      ref={ref}
      className={tw(
        "text-md py-1.5 pl-8 pr-2 font-medium text-color-700",
        className
      )}
      {...props}
    />
  );
});

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(function SelectItem({ className, children, ...props }, ref) {
  return (
    <SelectPrimitive.Item
      ref={ref}
      className={tw(
        "relative flex cursor-default select-none items-center rounded p-1 text-sm font-medium outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 focus:bg-color-50 ",
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
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
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
