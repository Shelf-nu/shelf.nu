import type { Booking } from "@prisma/client";
import { Zap } from "lucide-react";
import type { CheckoutSourceQuestion } from "~/modules/booking/checkout-source-location";
import { isBookingEarlyCheckout } from "~/modules/booking/helpers";
import type { UnassignedModelUnits } from "~/utils/booking-model-requests";
import { summarizeUnassignedUnits } from "~/utils/booking-model-requests";
import { tw } from "~/utils/tw";
import { CheckoutSourceSelect } from "./checkout-source-select";
import type { ButtonProps } from "../shared/button";
import { Button } from "../shared/button";
import { DateS } from "../shared/date";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../shared/modal";

export enum CheckoutIntentEnum {
  "with-adjusted-date" = "with-adjusted-date",
  "without-adjusted-date" = "without-adjusted-date",
}

type CheckoutDialogProps = {
  disabled?: ButtonProps["disabled"];
  booking: Pick<Booking, "id" | "name" | "from">;
  /** A container to render the AlertContent inside */
  portalContainer?: HTMLElement;
  /** Form ID for explicit form association when buttons render in a portal */
  formId?: string;
  /**
   * Optional className override for the trigger button. Defaults to the
   * variant-aware composition below (`"grow"` for the default variant,
   * full-width link styling for `"dropdown"`). Embedded contexts (e.g. the
   * fulfil-and-checkout drawer) can pass a narrower class so the button
   * doesn't stretch oddly when its sibling buttons aren't also `grow`.
   */
  triggerClassName?: string;
  /**
   * The form `intent` submitted with the checkout. Defaults to the full-booking
   * `"checkOut"` flow. The bulk partial-checkout dialog passes
   * `"partial-checkout"` so that an early checkout of the SELECTED assets routes
   * through `checkoutAssets` / `partialCheckoutBooking` (which records the batch
   * and applies the adjusted-date choice) instead of the whole-booking
   * `checkoutBooking`. The scanner checkout-assets route ignores intent (always
   * partial), so it can leave the default.
   */
  intent?: string;
  /** Custom label for the trigger button */
  label?: string;
  /**
   * Rendering context. `"dropdown"` styles the trigger as a left-aligned link
   * row so it sits inside a `DropdownMenuItem` like the check-in flow.
   */
  variant?: "default" | "dropdown";
  /**
   * Skip the early-checkout "adjust start date" prompt and submit directly.
   * Pass `true` when the booking has already started (ONGOING/OVERDUE) — e.g.
   * "Check out remaining" — because adjusting the start date only makes sense
   * for the first checkout that transitions RESERVED → ONGOING.
   * `partialCheckoutBooking` ignores the date choice unless the booking is
   * RESERVED, so prompting here would be a confusing no-op.
   */
  suppressEarlyCheckoutPrompt?: boolean;
  /** Render the trigger button full-width to match a sibling full-width button. */
  fullWidth?: boolean;
  /**
   * Reserved model units no asset has been assigned to yet. When any are
   * listed, the trigger opens a confirmation naming them before the check-out
   * submits: they stay open on the booking, and the operator should know that
   * before the booking goes out without them.
   */
  unassignedUnits?: UnassignedModelUnits[];
  /**
   * Pools on the booking that sit at two or more locations and are about to
   * go out for the first time. When any are listed, the trigger opens a
   * confirmation with one "From location" select per pool; otherwise the
   * check-out stays one click.
   */
  sourceQuestions?: CheckoutSourceQuestion[];
};

/**
 * Stable empty lists for the defaults below: a fresh `[]` per render would be
 * a new prop value every time for a caller that passes nothing.
 */
const NO_UNASSIGNED_UNITS: UnassignedModelUnits[] = [];
const NO_SOURCE_QUESTIONS: CheckoutSourceQuestion[] = [];

/**
 * The confirm dialog's title: the most pressing reason it opened.
 *
 * @returns One short line
 */
function checkoutDialogTitle({
  hasUnassigned,
  isEarlyCheckout,
}: {
  hasUnassigned: boolean;
  isEarlyCheckout: boolean;
}): string {
  if (hasUnassigned) return "Some reserved units aren't assigned";
  if (isEarlyCheckout) return "Early Check-Out Warning";
  return "Where do the units come from?";
}

export default function CheckoutDialog({
  disabled,
  booking,
  portalContainer,
  formId,
  triggerClassName,
  intent = "checkOut",
  label = "Check Out",
  variant = "default",
  suppressEarlyCheckoutPrompt = false,
  fullWidth = false,
  unassignedUnits = NO_UNASSIGNED_UNITS,
  sourceQuestions = NO_SOURCE_QUESTIONS,
}: CheckoutDialogProps) {
  const isEarlyCheckout =
    !suppressEarlyCheckoutPrompt && isBookingEarlyCheckout(booking.from);
  const unassignedSummary = summarizeUnassignedUnits(unassignedUnits);
  const unassignedUnitCount = unassignedUnits.reduce(
    (sum, unit) => sum + Math.max(0, unit.count),
    0
  );

  /** Shared trigger styling so the dropdown row matches the check-in dropdown */
  const isDropdown = variant === "dropdown";
  /**
   * Default trigger styling computed from `variant`. Callers can override the
   * entire class via the `triggerClassName` prop (e.g. the fulfil-and-checkout
   * drawer narrows the button so it doesn't stretch oddly next to siblings).
   */
  const computedTriggerClassName = tw(
    "whitespace-nowrap",
    isDropdown
      ? "w-full justify-start px-4 py-3 text-gray-700 hover:text-gray-700"
      : "grow"
  );
  const resolvedTriggerClassName = triggerClassName ?? computedTriggerClassName;
  /** Dropdown rows pair the label with an icon; the default trigger is text-only */
  const triggerContent = isDropdown ? (
    <span className="flex items-center gap-2">
      <Zap className="size-4" /> {label}
    </span>
  ) : (
    label
  );

  const asksSource = sourceQuestions.length > 0;

  if (!isEarlyCheckout && !unassignedSummary && !asksSource) {
    return (
      <Button
        disabled={disabled}
        className={resolvedTriggerClassName}
        size={isDropdown ? undefined : "sm"}
        type="submit"
        name="intent"
        value={intent}
        form={formId}
        variant={isDropdown ? "link" : "primary"}
        width={isDropdown || fullWidth ? "full" : undefined}
      >
        {triggerContent}
      </Button>
    );
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          disabled={disabled}
          className={resolvedTriggerClassName}
          size={isDropdown ? undefined : "sm"}
          type="button"
          variant={isDropdown ? "link" : "primary"}
          width={isDropdown || fullWidth ? "full" : undefined}
        >
          {triggerContent}
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent portalProps={{ container: portalContainer }}>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {checkoutDialogTitle({
              hasUnassigned: Boolean(unassignedSummary),
              isEarlyCheckout,
            })}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-3">
              {unassignedSummary ? (
                <p>
                  <span className="font-bold text-gray-700">
                    {unassignedSummary}
                  </span>{" "}
                  {unassignedUnitCount === 1
                    ? "is not assigned yet. It stays on the booking so you can scan it later or release it."
                    : "are not assigned yet. They stay on the booking so you can scan them later or release them."}
                </p>
              ) : null}
              {isEarlyCheckout ? (
                <p>
                  You are checking out the booking more than 15 minutes before
                  the start date. If you proceed, the start date will be
                  adjusted to now:{" "}
                  <span className="font-bold text-gray-700">
                    <DateS date={new Date()} includeTime />
                  </span>
                  . Do you want to adjust the start date or keep the original
                  date?
                </p>
              ) : null}
              {asksSource ? (
                <p>
                  {sourceQuestions.length === 1
                    ? "This item is kept at more than one location."
                    : "These items are kept at more than one location."}{" "}
                  Pick where the units leave from. Units used up on this booking
                  come off that location at check-in.
                </p>
              ) : null}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        {asksSource ? (
          <div className="flex max-h-72 flex-col gap-3 overflow-y-auto">
            {sourceQuestions.map((question) => (
              <CheckoutSourceSelect
                key={question.sliceId}
                question={question}
                fieldKey={question.sliceId}
                formId={formId}
                disabled={Boolean(disabled)}
              />
            ))}
          </div>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button type="button" disabled={disabled} variant="secondary">
              Cancel
            </Button>
          </AlertDialogCancel>

          {isEarlyCheckout ? (
            <>
              <input type="hidden" name="intent" value={intent} form={formId} />
              <Button
                disabled={disabled}
                className="flex-1"
                type="submit"
                variant="secondary"
                name="checkoutIntentChoice"
                value={CheckoutIntentEnum["without-adjusted-date"]}
                form={formId}
              >
                Don't Adjust Date
              </Button>

              <Button
                disabled={disabled}
                className="flex-1"
                type="submit"
                name="checkoutIntentChoice"
                value={CheckoutIntentEnum["with-adjusted-date"]}
                form={formId}
              >
                Adjust Date
              </Button>
            </>
          ) : (
            <Button
              disabled={disabled}
              className="flex-1"
              type="submit"
              name="intent"
              value={intent}
              form={formId}
            >
              {unassignedSummary ? "Check out anyway" : "Check out"}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
