/**
 * Custody Source Select
 *
 * The "From location" (Assign custody) and "At location" (Adjust quantity)
 * picker for a quantity-tracked asset placed at two or more locations. Lists
 * each manual placement as
 * "Camera Room · 2 pcs", adding "· 1 in custody" when some of its units are
 * out, and "Unplaced · 3 pcs" when the pool has unplaced units.
 *
 * Built on the shared {@link SourceLocationPicker}, and mirrors its value into
 * a hidden input so the enclosing fetcher form posts it as `locationId` (a
 * location id, or `"unplaced"` for the unplaced units).
 *
 * Render it only when the pool is placed at two or more locations: callers
 * gate on `CustodySourceSummary.multiSource`, so a pool at one location keeps
 * its dialog exactly as it was.
 *
 * @see {@link file://../../modules/asset/custody-source.ts}
 * @see {@link file://./quantity-custody-dialog.tsx}
 * @see {@link file://./quick-adjust-dialog.tsx}
 */

import { sourceCommitmentParts } from "@shelf/quantity-control";
import { SourceLocationPicker } from "~/components/location/source-location-picker";
import type { CustodySourceOption } from "~/modules/asset/custody-source";
import { tw } from "~/utils/tw";

/**
 * The text of one option: "Camera Room · 2 pcs", "Camera Room · 2 pcs · 1 in
 * custody · 1 on a booking", or "Unplaced · 3 pcs". The same words as the
 * location page's row. Plain counts only: the dialog's Max is the lower of
 * the pool-wide availability and the chosen option's units left, so these
 * numbers never contradict it.
 */
export function formatCustodySourceOption(
  option: CustodySourceOption,
  unitLabel: string
): string {
  return [
    option.label,
    `${option.placed} ${unitLabel}`,
    ...sourceCommitmentParts(option),
  ].join(" · ");
}

/** Props for {@link CustodySourceSelect}. */
export type CustodySourceSelectProps = {
  /** Unique id for the trigger, tying the label to it. */
  id: string;
  /** "From location" or "At location". */
  label: string;
  /** The choices, from `CustodySourceSummary.options`. */
  options: CustodySourceOption[];
  /** The selected option's `value`. */
  value: string;
  /** Called with the chosen option's `value`. */
  onChange: (value: string) => void;
  /** Unit label for the counts ("pcs", "boxes", "units"). */
  unitLabel: string;
  /**
   * Form field the value is posted under. `null` renders no hidden input,
   * for callers that build their payload themselves (the scanner drawer).
   */
  name?: string | null;
  disabled?: boolean;
  /** Smaller label and trigger, for a scanned row in a drawer. */
  compact?: boolean;
};

/**
 * A single-choice picker of a pool's sources that posts the chosen one as a
 * hidden form field.
 *
 * @param props - See {@link CustodySourceSelectProps}
 */
export function CustodySourceSelect({
  id,
  label,
  options,
  value,
  onChange,
  unitLabel,
  name = "locationId",
  disabled = false,
  compact = false,
}: CustodySourceSelectProps) {
  return (
    <div className="flex flex-col gap-1">
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <label
        htmlFor={id}
        className={tw(
          "font-medium text-gray-700",
          compact ? "text-xs" : "text-sm"
        )}
      >
        {label}
      </label>
      <SourceLocationPicker
        id={id}
        options={options.map((option) => ({
          value: option.value,
          label: formatCustodySourceOption(option, unitLabel),
        }))}
        value={value}
        onChange={onChange}
        listLabel={label}
        disabled={disabled}
        compact={compact}
      />
    </div>
  );
}
