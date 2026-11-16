/**
 * @file The question the import mapping review asks when a file maps a
 * quantity column but no type column: are the rows individual assets, or
 * stock, and is that stock returned or used up?
 *
 * The importer accepts a quantity above 1 only on a quantity-tracked row, and
 * a quantity-tracked row needs a consumption type. A file without a type
 * column cannot say either, so the user answers once for the whole file.
 *
 * @see {@link file://./../import-content/flow.tsx} the flow that owns the answer
 * @see {@link file://./../../../modules/import-mapping/apply.ts} how it is applied
 */
import type { QuantityTracking } from "~/modules/import-mapping/types";
import { tw } from "~/utils/tw";

/** The options, in the order they are listed. */
const OPTIONS: Array<{
  value: QuantityTracking;
  label: string;
  hint: string;
}> = [
  {
    value: "INDIVIDUAL",
    label: "Individual assets",
    hint: "One asset per row. Every quantity must be 1.",
  },
  {
    value: "TWO_WAY",
    label: "Stock, returned after use",
    hint: "Each row is tracked by quantity and checked back in after use.",
  },
  {
    value: "ONE_WAY",
    label: "Stock, used up",
    hint: "Each row is tracked by quantity and consumed when checked out.",
  },
];

/**
 * Radio group for a {@link QuantityTracking} choice.
 *
 * @param props.value - The current choice, or `null` when none is made yet
 * @param props.onChange - Called with the option the user picks
 */
export function QuantityTrackingChoice({
  value,
  onChange,
}: {
  value: QuantityTracking | null;
  onChange: (value: QuantityTracking) => void;
}) {
  return (
    <fieldset className="mt-4 rounded border border-gray-200 p-4">
      <legend className="px-1 text-[14px] font-medium text-gray-900">
        How should these rows be tracked?
      </legend>
      <p className="mb-3 text-[14px] text-gray-600">
        Your file has a quantity column but no type column. Pick how its rows
        come into Shelf.
      </p>
      <div className="flex flex-col gap-2">
        {OPTIONS.map((option) => {
          const id = `import-quantity-tracking-${option.value}`;
          return (
            <div
              key={option.value}
              className={tw(
                "flex items-start gap-3 rounded border p-3",
                value === option.value
                  ? "border-primary-300 bg-primary-25"
                  : "border-gray-200"
              )}
            >
              <input
                id={id}
                type="radio"
                name="import-quantity-tracking"
                value={option.value}
                checked={value === option.value}
                onChange={() => onChange(option.value)}
                aria-describedby={`${id}-hint`}
                className="mt-0.5"
              />
              <div>
                <label
                  htmlFor={id}
                  className="block cursor-pointer text-[14px] font-medium text-gray-900"
                >
                  {option.label}
                </label>
                <p id={`${id}-hint`} className="text-xs text-gray-600">
                  {option.hint}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
