/**
 * "From location" select for a pool on a booking check-out.
 *
 * Rendered once per quantity-tracked asset ("pool") that sits at two or more
 * manual placements, wherever such a pool is about to be checked out: the
 * confirm dialog behind the one-click "Check out", the partial check-out
 * dialog, and the scanner drawers. The submitted value is recorded on the
 * booking slice so check-in can take used-up units off the right location.
 *
 * Built on the shared {@link SourceLocationPicker}, the popover list custody's
 * "From location" uses. The answer rides a hidden input that names its form
 * (pass `formId`), so it posts with the form even when the dialog renders in
 * a portal.
 *
 * It posts only an answer the operator gave. Until they pick one there is no
 * hidden input, so nothing is sent and the server records its own default,
 * worked out from the data at submit time: the same rule that chose the
 * pre-selected option. A pre-selection that went stale (its placement was
 * deleted while the dialog was open) therefore never comes back as a refused
 * "pick".
 *
 * @see {@link file://../../modules/booking/checkout-source-location.ts} the rule and the option labels
 */
import { useId, useState } from "react";

import { SourceLocationPicker } from "~/components/location/source-location-picker";
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
 * pick if nothing were sent, and posted only once the operator changes it.
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
  /** The pre-selected option: what the server records if nothing is posted. */
  const [value, setValue] = useState(
    question.defaultLocationId ?? UNPLACED_SOURCE_FORM_VALUE
  );
  /** Whether the operator picked an answer: only then is it posted. */
  const [picked, setPicked] = useState(false);
  const isInline = variant === "inline";

  return (
    <div
      className={tw(
        isInline ? "flex items-center gap-2" : "flex flex-col gap-1",
        className
      )}
    >
      {/* A disabled select was left out of the submission; so is this. */}
      {picked && !disabled ? (
        <input
          type="hidden"
          name={sourceLocationFieldName(fieldKey)}
          value={value}
          form={formId}
        />
      ) : null}
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
      <div className={tw("min-w-0", isInline ? "flex-1" : "w-full")}>
        <SourceLocationPicker
          id={id}
          options={options}
          value={value}
          onChange={(next) => {
            // Re-choosing the pre-selected option is not an answer: posting it
            // would turn the server's own default into a pick it can refuse.
            if (next === value) return;
            setValue(next);
            setPicked(true);
          }}
          listLabel={`From location for ${question.title}`}
          triggerAriaLabel={
            isInline ? `From location for ${question.title}` : undefined
          }
          disabled={disabled}
          triggerClassName="rounded-md"
        />
      </div>
    </div>
  );
}
