/**
 * Progressive Check-in/out Settings
 *
 * Renders the workspace booking-settings card for progressive check-in/out
 * display options. Currently exposes a single auto-saving toggle that controls
 * whether a kit is counted as one unit (rather than counting the individual
 * assets inside it) when visualising the progress of a booking's check-in/out.
 *
 * The toggle follows the auto-save pattern used by the other booking-settings
 * switches: flipping the switch immediately submits the enclosing fetcher form,
 * so there is no explicit Save button.
 *
 * @see {@link file://./../../routes/_layout+/settings.bookings.tsx} for the
 *   loader/action that persists this setting via `updateBookingSettings`.
 */

import { useFetcher } from "react-router";
import { useZorm } from "react-zorm";
import z from "zod";
import FormRow from "~/components/forms/form-row";
import { Switch } from "~/components/forms/switch";
import { Card } from "~/components/shared/card";
import { useDisabled } from "~/hooks/use-disabled";

/**
 * Validation schema for the "count each kit as a single unit" toggle.
 *
 * The HTML checkbox submits the string `"on"` when checked and omits the field
 * when unchecked, so we coerce to a boolean and default to `false`.
 */
export const CountKitsAsUnitSettingsSchema = z.object({
  countKitsAsSingleUnit: z
    .string()
    .transform((val) => val === "on")
    .default("false"),
});

/**
 * Workspace booking-settings card for progressive check-in/out display options.
 *
 * @param props - Component props
 * @param props.header - Card header content (title and optional sub-heading)
 * @param props.defaultValue - Current persisted value of `countKitsAsSingleUnit`;
 *   used as the switch's initial checked state
 * @returns A card containing the auto-saving "count each kit as a single unit"
 *   toggle
 */
export function ProgressiveCheckinSettings({
  header,
  defaultValue = false,
}: {
  header: { title: string; subHeading?: string };
  defaultValue: boolean;
}) {
  const fetcher = useFetcher();
  const disabled = useDisabled();
  const zo = useZorm("CountKitsAsUnitForm", CountKitsAsUnitSettingsSchema);
  // Bind the (visually hidden) label to the Switch via a shared id so the
  // control has a reliable, programmatically-associated accessible name.
  const countKitsField = zo.fields.countKitsAsSingleUnit();
  const countKitsFieldId = `countKitsAsSingleUnit-${countKitsField}`;

  return (
    <Card>
      <div className="mb-4 border-b pb-4">
        <h3 className="text-text-lg font-semibold">{header.title}</h3>
        <p className="text-sm text-gray-600">{header.subHeading}</p>
      </div>
      <div>
        <fetcher.Form
          ref={zo.ref}
          method="post"
          onChange={(e) => void fetcher.submit(e.currentTarget)}
        >
          <FormRow
            rowLabel="Count each kit as a single unit"
            subHeading={
              <div>
                When visualising the state of a booking, treat each kit as one
                unit rather than counting the assets inside it.
              </div>
            }
            className="border-b-0 pb-[10px] pt-0"
          >
            <div className="flex flex-col items-center gap-2">
              <Switch
                id={countKitsFieldId}
                name={countKitsField}
                disabled={disabled}
                defaultChecked={defaultValue}
                title="Count each kit as a single unit"
              />
              <label htmlFor={countKitsFieldId} className="sr-only">
                Count each kit as a single unit
              </label>
            </div>
          </FormRow>
          <input
            type="hidden"
            value="updateCountKitsAsSingleUnit"
            name="intent"
          />
        </fetcher.Form>
      </div>
    </Card>
  );
}
