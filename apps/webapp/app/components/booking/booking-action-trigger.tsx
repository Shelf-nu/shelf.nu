/**
 * The trigger every booking-scoped action renders: a menu row inside a
 * dropdown, or a compact icon button with a tooltip in a list row.
 *
 * It forwards its ref and spreads the rest of its props onto the button, so a
 * Radix `AlertDialogTrigger asChild`, `PopoverTrigger asChild` or
 * `DropdownMenuItem asChild` can attach its handlers and ref to the element.
 *
 * @see {@link file://./cancel-booking-dialog.tsx}
 * @see {@link file://./archive-booking-action.tsx}
 * @see {@link file://./duplicate-booking-action.tsx}
 * @see {@link file://./booking-quick-actions.tsx} the icon look this matches
 */
import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Button } from "~/components/shared/button";
import { tw } from "~/utils/tw";
import type { BookingActionDisabled } from "./booking-actions";

/** How an action presents itself: a row in a menu, or an icon button. */
export type BookingActionTriggerVariant = "menu-item" | "icon";

/** Props for {@link BookingActionTrigger}. */
export type BookingActionTriggerProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "disabled" | "type"
> & {
  /** Menu row or icon button. */
  variant: BookingActionTriggerVariant;
  /** The visible text of a menu row; the tooltip and accessible name of an icon. */
  label: string;
  /** Shown only by the `"icon"` variant. */
  icon: ReactNode;
  /** Disabled state, with the reason the viewer is shown. */
  disabled?: BookingActionDisabled;
  /** Renders a link instead of a button (Duplicate). */
  to?: string;
};

/** Today's menu row styling, shared by every action in the Actions dropdown. */
const MENU_ITEM_CLASS =
  "justify-start rounded-sm px-2 py-1.5 text-sm font-medium text-gray-700 outline-none hover:cursor-pointer hover:bg-slate-100 hover:text-gray-700";

/**
 * Renders a booking action's trigger.
 *
 * @param props - See {@link BookingActionTriggerProps}
 */
export const BookingActionTrigger = forwardRef<
  HTMLButtonElement,
  BookingActionTriggerProps
>(function BookingActionTrigger(
  { variant, label, icon, disabled = false, to, className, ...rest },
  ref
) {
  const look =
    variant === "icon"
      ? ({
          size: "sm",
          variant: "secondary",
          className: tw("p-2", className),
          "aria-label": label,
          tooltip: label,
          children: icon,
        } as const)
      : ({
          variant: "link",
          width: "full",
          className: tw(MENU_ITEM_CLASS, className),
          children: label,
        } as const);

  if (to) {
    return (
      <Button
        {...rest}
        {...look}
        to={to}
        disabled={disabled || undefined}
        ref={ref}
      />
    );
  }

  return (
    <Button
      {...rest}
      {...look}
      type="button"
      disabled={disabled || undefined}
      ref={ref}
    />
  );
});
