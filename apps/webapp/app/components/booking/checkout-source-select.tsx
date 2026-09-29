/**
 * "From location" select for a pool on a booking check-out.
 *
 * Rendered once per quantity-tracked asset ("pool") that sits at two or more
 * manual placements, wherever such a pool is about to be checked out: the
 * confirm dialog behind the one-click "Check out", the partial check-out
 * dialog, and the scanner drawers. The submitted value is recorded on the
 * booking slice so check-in can take used-up units off the right location.
 *
 * A native `<select>`, like the placements editor, so it posts with the form
 * even when the dialog renders in a portal (pass `formId`).
 *
 * @see {@link file://../../modules/booking/checkout-source-location.ts} the rule and the option labels
 */
import { useId } from "react";

import type { CheckoutSourceQuestion } from "~/modules/booking/checkout-source-location";
import {
  checkoutSourceOptions,
  sourceLocationFieldName,
  sourceUnitLabel,
  UNPLACED_SOURCE_FORM_VALUE,
} from "~/modules/booking/checkout-source-location";
import { tw } from "~/utils/tw";

/** Props for {@link CheckoutSourceSelect}. */
type CheckoutSourceSelectProps = {
  /** The pool being asked about, from the page's loader. */
  question: Pick<
    CheckoutSourceQuestion,
    | "title"
    | "quantity"
    | "unitOfMeasure"
    | "placements"
    | "unplaced"
    | "defaultLocationId"
  >;
  /**
   * What the answer is keyed by: the slice id (`BookingAsset.id`) when the
   * slice already exists, or the asset id when the check-out adds it in the
   * same request.
   */
  fieldKey: string;
  /** Associates the select with a form it is not nested in (portaled dialogs). */
  formId?: string;
  disabled?: boolean;
  /**
   * `"titled"` names the asset and the units leaving above the select, for a
   * dialog that lists several pools. `"inline"` shows only "From", for a row
   * that already shows the asset.
   */
  variant?: "titled" | "inline";
  className?: string;
};

/**
 * One "From location" select, pre-selected with the location the server would
 * pick if nothing were sent.
 *
 * @param props - {@link CheckoutSourceSelectProps}
 */
export function CheckoutSourceSelect({
  question,
  fieldKey,
  formId,
  disabled,
  variant = "titled",
  className,
}: CheckoutSourceSelectProps) {
  const id = useId();
  const options = checkoutSourceOptions(question);
  const defaultValue = question.defaultLocationId ?? UNPLACED_SOURCE_FORM_VALUE;
  const isInline = variant === "inline";

  return (
    <div
      className={tw(
        isInline ? "flex items-center gap-2" : "flex flex-col gap-1",
        className
      )}
    >
      <label
        htmlFor={id}
        className={tw(
          "text-xs font-medium text-gray-700",
          isInline && "shrink-0"
        )}
      >
        {isInline ? (
          "From"
        ) : (
          <>
            <span className="text-gray-900">{question.title}</span>
            <span className="font-normal text-gray-500">
              {" "}
              · {question.quantity} {sourceUnitLabel(question.unitOfMeasure)}
            </span>
          </>
        )}
      </label>
      <select
        id={id}
        name={sourceLocationFieldName(fieldKey)}
        defaultValue={defaultValue}
        form={formId}
        disabled={disabled}
        aria-label={
          isInline ? `From location for ${question.title}` : undefined
        }
        className={tw(
          "h-9 min-w-0 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-900",
          "focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500",
          isInline ? "flex-1" : "w-full"
        )}
      >
        {options.map((option) => (
          <option key={option.value || "unplaced"} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
